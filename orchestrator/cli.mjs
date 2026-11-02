#!/usr/bin/env node
// One poll: run whatever step is due, then exit. Start it by hand or from a loop.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { signedIn } from "./checks.mjs";
import { buildArgs, buildSettings, runClaude } from "./claude.mjs";
import { defaultPaths, entryFor, linearKeyFor, loadConfig } from "./config.mjs";
import { escalate } from "./escalate.mjs";
import { createGithub } from "./github.mjs";
import { handoff } from "./handoff.mjs";
import { exec } from "./exec.mjs";
import { collectIssues, createLinear } from "./linear.mjs";
import { appendLog } from "./log.mjs";
import { loadSecrets, notify } from "./notify.mjs";
import { poll } from "./poll.mjs";
import { answer, implement, review } from "./steps.mjs";
import { addReviewCheckout, addWorktree, cleanupWorktrees, pruneWorktrees, removeWorktree } from "./worktree.mjs";

const paths = { ...defaultPaths(), ...(process.env.SOFTWARE_FACTORY_CONFIG ? { config: process.env.SOFTWARE_FACTORY_CONFIG } : {}) };
const config = loadConfig(paths.config);
const secrets = loadSecrets(paths.secrets);
const send = (n) => notify(n, { secrets });

const ownerOf = (ticket) => {
  const entry = entryFor(config, ticket);
  if (!entry) throw new Error(`No config entry for ${ticket.key} (team ${ticket.team}, project ${ticket.project})`);
  return entry;
};

const depsFor = (entry) => {
  const github = createGithub({ githubRepo: entry.githubRepo, trustedAuthors: config.trustedAuthors, previewAuthors: config.previewAuthors });
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
      removeWorktree: (repo, path) => removeWorktree(repo, path),
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
  const { stdout } = await exec("claude", ["auth", "status"], { timeoutMs: 30_000 }).catch((e) => ({ stdout: e.stdout ?? "" }));
  const status = signedIn(stdout);
  if (!status.ok) throw new Error(status.message);
};

const forTicket = (ticket) => depsFor(ownerOf(ticket));
const run = {
  implement: (t) => implement(t, forTicket(t)),
  review: (t) => review(t, forTicket(t)),
  answer: (t) => answer(t, forTicket(t)),
  handoff: (t) => handoff(t, forTicket(t)),
  escalate: (t, reason, extra) => escalate(t, reason, forTicket(t), extra),
};

const clients = config.entries.map((entry) => ({ entry, linear: createLinear(linearKeyFor(entry.repo)) }));

const cleanup = (tickets) =>
  cleanupWorktrees(tickets, {
    prState: (pr, ticket) => forTicket(ticket).github.prState(pr),
    remove: async (ticket) => {
      const { repo } = ownerOf(ticket);
      await removeWorktree(repo, ticket.worktree);
      await pruneWorktrees(repo);
    },
  });

// Exit code 0: the poll ran, whether or not it acted. 1: it failed, e.g. signed out or Linear unreachable.
try {
  const result = await poll({
    stateDir: paths.state,
    now: new Date(),
    config,
    deps: {
      preflight,
      notify: send,
      run,
      cleanup,
      linear: { listIssues: () => collectIssues(clients) },
    },
  });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
