import { validBranch } from "./access.mjs";
import { judgeRun, parseLimit } from "./checks.mjs";
import { runRecord } from "./log.mjs";

const fail = (ticket, judged, extra = {}) => ({
  ...ticket,
  ...extra,
  phase: "failed",
  reason: judged.reason,
  kind: judged.kind,
  denied: judged.denied,
});

// One headless run. Returns the judged output, or throws {planLimit} to pause the script.
const run = async (ticket, deps, step, call, expect) => {
  let output;
  try {
    output = await deps.claude({
      ...call,
      model: deps.config.model,
      maxTurns: deps.config.maxTurns,
      timeoutMs: deps.config.runTimeoutMs,
    });
  } catch (error) {
    if (error.timedOut) {
      return {
        judged: { ok: false, kind: "timeout", reason: `The run hit its ${deps.config.runTimeoutMs} ms time limit.` },
      };
    }
    throw error;
  }
  deps.log?.(runRecord(output, { key: ticket.key, step, at: new Date().toISOString(), priorCostUsd: call.priorCostUsd }));
  const limit = parseLimit(output, { now: new Date() });
  if (limit) throw Object.assign(new Error("Plan limit reached"), { planLimit: limit });
  return { output, judged: judgeRun(output, { maxTurns: deps.config.maxTurns, expect }) };
};

export const implement = async (ticket, deps) => {
  if (!validBranch(ticket.branch)) {
    return fail(ticket, { kind: "branch", reason: `Branch name ${JSON.stringify(ticket.branch)} is not a valid branch name.` });
  }
  await deps.linear.setStatus(ticket.key, "In Progress");
  const worktree = await deps.git.addWorktree({
    repo: deps.config.repo,
    branch: ticket.branch,
    base: deps.config.base,
  });
  const { output, judged } = await run(
    ticket,
    deps,
    "implement",
    { prompt: `/software-factory:start-ticket ${ticket.key} --unattended`, cwd: worktree },
    "implement",
  );
  if (!judged.ok) return fail(ticket, judged, { worktree, sessionId: output?.session_id });
  const pr = await deps.github.findPr(ticket.branch);
  if (!pr) return fail(ticket, { kind: "no-pr", reason: "The run finished but no PR from the branch exists." }, { worktree, sessionId: output.session_id });
  return {
    ...ticket,
    phase: "implemented",
    worktree,
    sessionId: output.session_id,
    costUsd: output.total_cost_usd,
    pr: pr.number,
    prUrl: pr.url,
  };
};

export const review = async (ticket, deps) => {
  const cwd = await deps.git.addReviewCheckout({ repo: deps.config.repo, pr: ticket.pr });
  try {
    const { judged } = await run(
      ticket,
      deps,
      "review",
      { prompt: `/software-factory:pr-review ${ticket.pr} --unattended`, cwd },
      "review",
    );
    if (!judged.ok) return fail(ticket, judged);
    const outcome = await deps.github.reviewOutcome(ticket.pr);
    if (!outcome) return fail(ticket, { kind: "no-review", reason: "The review run finished but no review comment from a trusted author was found." });
    return { ...ticket, phase: "reviewed", outcome, reviews: ticket.reviews + 1 };
  } finally {
    await deps.git.removeWorktree(deps.config.repo, cwd).catch(() => {});
  }
};

export const answer = async (ticket, deps) => {
  const call = { prompt: `/software-factory:address-review ${ticket.pr} --unattended`, cwd: ticket.worktree };
  let result;
  let freshAnswer;
  try {
    result = await run(ticket, deps, "answer", { ...call, resume: ticket.sessionId, priorCostUsd: ticket.costUsd }, "answer");
  } catch (error) {
    if (error.code !== "RESUME_FAILED") throw error;
    freshAnswer = true;
    result = await run(ticket, deps, "answer", call, "answer");
  }
  if (!result.judged.ok) return fail(ticket, result.judged, { freshAnswer });
  return {
    ...ticket,
    phase: "answered",
    sessionId: result.output.session_id,
    ...(freshAnswer ? { freshAnswer } : {}),
  };
};
