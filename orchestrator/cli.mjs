#!/usr/bin/env node
// One poll: run whatever step is due, then exit. Start it by hand or from a loop.
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { signedIn } from "./checks.mjs";
import { buildArgs, buildSettings, runClaude } from "./claude.mjs";
import { defaultPaths, linearKeyFor, loadConfig, projectFor } from "./config.mjs";
import { escalate } from "./escalate.mjs";
import { createGithub } from "./github.mjs";
import { handoff } from "./handoff.mjs";
import { createLinear } from "./linear.mjs";
import { appendLog } from "./log.mjs";
import { loadSecrets, notify } from "./notify.mjs";
import { poll } from "./poll.mjs";
import { answer, implement, review } from "./steps.mjs";
import { loadState, saveState } from "./state.mjs";
import { addReviewCheckout, addWorktree, removeWorktree, staleWorktrees } from "./worktree.mjs";

const paths = { ...defaultPaths(), ...(process.env.SOFTWARE_FACTORY_CONFIG ? { config: process.env.SOFTWARE_FACTORY_CONFIG } : {}) };
const config = loadConfig(paths.config);
const secrets = loadSecrets(paths.secrets);
const send = (n) => notify(n, { secrets });

const entryFor = (project) => {
  const entry = projectFor(config, project);
  if (!entry) throw new Error(`No config entry for Linear project ${project}`);
  return entry;
};

const depsFor = (entry) => {
  const github = createGithub({ githubRepo: entry.githubRepo, trustedAuthors: config.trustedAuthors });
  const settings = join(paths.state, `settings-${Buffer.from(entry.repo).toString("hex").slice(0, 12)}.json`);
  mkdirSync(paths.state, { recursive: true });
  writeFileSync(settings, JSON.stringify(buildSettings(entry, { base: config.base })));
  return {
    config: { ...config, repo: entry.repo },
    linear: createLinear(linearKeyFor(entry.repo)),
    github,
    git: {
      addWorktree: (a) => addWorktree(a, paths.worktrees),
      addReviewCheckout: (a) => addReviewCheckout(a, paths.worktrees),
    },
    claude: async ({ prompt, cwd, resume, model, maxTurns, timeoutMs }) => {
      const result = await runClaude({ args: buildArgs({ prompt, model, maxTurns, resume, settings }), cwd, timeoutMs });
      if (result.timedOut) throw Object.assign(new Error("Run timed out"), { timedOut: true });
      if (result.resumeFailed) throw Object.assign(new Error("Session could not be resumed"), { code: "RESUME_FAILED" });
      if (!result.output) throw new Error(result.error);
      return result.output;
    },
    log: (record) => appendLog(paths.log, record),
    notify: send,
    sleep,
  };
};

const preflight = async () => {
  const { stdout } = await promisify(execFile)("claude", ["auth", "status"]).catch((e) => ({ stdout: e.stdout ?? "" }));
  const status = signedIn(stdout);
  if (!status.ok) throw new Error(status.message);
};

const forTicket = (ticket) => depsFor(entryFor(ticket.project));
const run = {
  implement: (t) => implement(t, forTicket(t)),
  review: (t) => review(t, forTicket(t)),
  answer: (t) => answer(t, forTicket(t)),
  handoff: (t) => handoff(t, forTicket(t)),
  escalate: (t, reason, extra) => escalate(t, reason, forTicket(t), extra),
};

const projects = config.entries.flatMap((e) => e.projects);
const lists = config.entries.map((e) => ({ project: e.projects, linear: createLinear(linearKeyFor(e.repo)) }));

try {
  const result = await poll({
    stateDir: paths.state,
    now: new Date(),
    config: { projects },
    deps: {
      preflight,
      notify: send,
      run,
      linear: { listIssues: async (names) => (await Promise.all(lists.map((l) => l.linear.listIssues(names.filter((n) => l.project.includes(n)))))).flat() },
    },
  });
  console.log(JSON.stringify(result));
  if (result.reason === "another invocation is running") process.exit(0);

  const state = loadState(paths.state);
  const states = {};
  for (const t of state.tickets) {
    if (t.worktree && t.pr) states[t.pr] = await forTicket(t).github.prState(t.pr);
  }
  const stale = staleWorktrees(state.tickets, states);
  for (const t of stale) await removeWorktree(entryFor(t.project).repo, t.worktree).catch(() => {});
  if (stale.length) saveState(paths.state, { ...state, tickets: state.tickets.map((t) => (stale.includes(t) ? { ...t, worktree: undefined } : t)) });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
