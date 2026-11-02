import { chooseIssue } from "./choose.mjs";
import { nextAction } from "./flow.mjs";
import { canStart, holdsSlot } from "./slot.mjs";
import { acquireLock, isPaused, loadState, recover, saveState } from "./state.mjs";

const MODEL_STEPS = new Set(["implement", "review", "answer"]);

const replace = (state, ticket) => ({
  ...state,
  tickets: state.tickets.some((t) => t.key === ticket.key)
    ? state.tickets.map((t) => (t.key === ticket.key ? ticket : t))
    : [...state.tickets, ticket],
});

// One invocation: run whatever step is due, then return. Nothing is due, nothing runs.
export const poll = async ({ stateDir, now, deps, config }) => {
  const release = acquireLock(stateDir);
  if (!release) return { acted: false, reason: "another invocation is running" };
  try {
    let state = loadState(stateDir);
    if (state.pausedUntil && new Date(state.pausedUntil) > now) {
      return { acted: false, reason: `paused until ${state.pausedUntil}` };
    }
    if (state.pausedUntil) state = { ...state, pausedUntil: null };

    let ticket = state.tickets.find(holdsSlot);
    if (ticket) {
      const recovery = recover(ticket);
      if (recovery.action === "escalate") {
        const escalated = await deps.run.escalate(ticket, "A run cut off by a restart was already resumed once.");
        saveState(stateDir, replace(state, { ...escalated, running: undefined }));
        return { acted: true, key: ticket.key, action: "escalate" };
      }
      ticket = recovery.ticket;
    } else {
      if (isPaused(stateDir) || config.projects.length === 0 || !canStart(state.tickets)) {
        saveState(stateDir, state);
        return { acted: false, reason: "no new work allowed" };
      }
      const issue = chooseIssue(await deps.linear.listIssues(config.projects), config);
      if (!issue) return { acted: false, reason: "nothing eligible" };
      ticket = {
        key: issue.key,
        branch: issue.gitBranchName,
        project: issue.project,
        issueUrl: issue.url,
        phase: "claimed",
        reviews: 0,
      };
    }

    const action = nextAction(ticket);
    if (action.type === "wait") return { acted: false, reason: `${ticket.key} is waiting` };
    if (MODEL_STEPS.has(action.type)) await deps.preflight?.();

    saveState(stateDir, replace(state, { ...ticket, running: { ...ticket.running, step: action.type, startedAt: now.toISOString() } }));
    let result;
    try {
      result = action.type === "escalate" ? await deps.run.escalate(ticket, action.reason, { denied: ticket.denied }) : await deps.run[action.type](ticket);
    } catch (error) {
      if (!error.planLimit) throw error;
      const resetAt = error.planLimit.resetAt.toISOString();
      saveState(stateDir, { ...replace(state, { ...ticket, running: undefined }), pausedUntil: resetAt });
      await deps.notify({
        kind: "pause",
        title: "Software factory paused",
        message: `Plan limit reached. Paused until ${resetAt}; ${ticket.key} keeps its place.`,
      });
      return { acted: true, key: ticket.key, action: "pause" };
    }
    if (result.phase === "failed") {
      result = await deps.run.escalate(result, result.reason, { denied: result.denied });
    }
    saveState(stateDir, replace(state, { ...result, running: undefined }));
    return { acted: true, key: ticket.key, action: action.type };
  } finally {
    release();
  }
};
