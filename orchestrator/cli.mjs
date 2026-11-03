#!/usr/bin/env node
// One poll: run whatever step is due, then exit. Start it by hand or from a loop.
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { signedIn } from "./checks.mjs";
import { buildArgs, buildSettings, killRunning, runClaude, settingsFile } from "./claude.mjs";
import { defaultPaths, entryFor, linearKeyFor, loadConfig } from "./config.mjs";
import { escalate } from "./escalate.mjs";
import { exec } from "./exec.mjs";
import { createGithub } from "./github.mjs";
import { handoff } from "./handoff.mjs";
import { collectIssues, createLinear } from "./linear.mjs";
import { appendLog } from "./log.mjs";
import { loadSecrets, notify } from "./notify.mjs";
import { poll } from "./poll.mjs";
import { releaseLock } from "./state.mjs";
import { answer, implement, review } from "./steps.mjs";
import { addReviewCheckout, addWorktree, cleanupWorktrees, pruneWorktrees, removeWorktree } from "./worktree.mjs";

const paths = { ...defaultPaths(), ...(process.env.SOFTWARE_FACTORY_CONFIG ? { config: process.env.SOFTWARE_FACTORY_CONFIG } : {}) };

// A stop must end the runs it started: Node does not emit `exit` for an unhandled signal.
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.on(signal, () => {
    killRunning();
    releaseLock(paths.state);
    process.exit(code);
  });
}

const main = async () => {
  const config = loadConfig(paths.config);
  const secrets = loadSecrets(paths.secrets);
  const send = (n) => notify(n, { secrets });
  const linearClients = new Map();
  const linearFor = (repo) => {
    if (!linearClients.has(repo)) linearClients.set(repo, createLinear(linearKeyFor(repo)));
    return linearClients.get(repo);
  };

  const ownerOf = (ticket) => {
    const entry = entryFor(config, ticket);
    if (!entry) throw new Error(`No config entry for ${ticket.key} (team ${ticket.team}, project ${ticket.project})`);
    return entry;
  };

  const depsByEntry = new Map();
  const depsFor = (entry) => {
    if (depsByEntry.has(entry)) return depsByEntry.get(entry);
    const settings = settingsFile(paths.state, entry.repo);
    mkdirSync(paths.state, { recursive: true });
    writeFileSync(settings, JSON.stringify(buildSettings(entry, { base: config.base })));
    const deps = {
      config: { ...config, repo: entry.repo },
      linear: linearFor(entry.repo),
      github: createGithub({ githubRepo: entry.githubRepo, trustedAuthors: config.trustedAuthors, previewAuthors: config.previewAuthors }),
      git: {
        addWorktree: (a) => addWorktree(a, paths.worktrees),
        addReviewCheckout: (a) => addReviewCheckout(a, paths.worktrees),
        removeWorktree,
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
    depsByEntry.set(entry, deps);
    return deps;
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

  const clients = config.entries.map((entry) => ({ entry, linear: linearFor(entry.repo) }));

  const cleanup = (tickets) =>
    cleanupWorktrees(tickets, {
      prState: (pr, ticket) => forTicket(ticket).github.prState(pr),
      remove: async (ticket) => {
        const { repo } = ownerOf(ticket);
        await removeWorktree(repo, ticket.worktree);
        await pruneWorktrees(repo);
      },
    });

  return poll({
    stateDir: paths.state,
    now: new Date(),
    config,
    deps: { preflight, notify: send, run, cleanup, linear: { listIssues: () => collectIssues(clients) } },
  });
};

// Exit code 0: the poll ran, whether or not it acted. 1: it failed, e.g. signed out or Linear unreachable.
try {
  console.log(JSON.stringify(await main()));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
