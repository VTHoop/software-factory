#!/usr/bin/env node
// Summarizes the orchestrator's state directory: what is running now, what each ticket cost,
// denied commands, identity failures, and the distinct recent poll errors.
//   node orchestrator/report.mjs [stateDir] [--json] [--since <ISO date>]
// stateDir defaults to the agent user's, or SF_STATE_DIR. Files are read directly (they are
// world-readable), so no sudo is needed.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim()) : []);

const parse = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

export const readRuns = (dir, since) =>
  lines(join(dir, "runs.jsonl"))
    .map(parse)
    .filter((r) => r && (!since || r.at >= since));

export const summarize = ({ runs, state, outLines = [], errLines = [], now = new Date() }) => {
  const tickets = {};
  const events = [];
  for (const r of runs) {
    if (r.event) {
      events.push(r);
      continue;
    }
    const t = (tickets[r.key] ??= { key: r.key, costUsd: 0, durationMs: 0, turns: 0, runs: 0, steps: {}, denied: 0, failedSubagents: 0, last: r.at });
    t.costUsd += r.costUsd ?? 0;
    t.durationMs += r.durationMs ?? 0;
    t.turns += r.turns ?? 0;
    t.runs += 1;
    t.steps[r.step] = (t.steps[r.step] ?? 0) + 1;
    t.denied += r.denied?.length ?? 0;
    t.failedSubagents += r.subagents?.failed ?? 0;
    if (r.at > t.last) t.last = r.at;
  }
  const acted = outLines.map(parse).filter(Boolean);
  const idle = acted.filter((o) => !o.acted);
  const errors = {};
  for (const e of errLines) errors[e] = (errors[e] ?? 0) + 1;
  return {
    running: (state?.tickets ?? [])
      .filter((t) => t.running)
      .map((t) => ({ key: t.key, step: t.running.step, minutes: Math.round((now - new Date(t.running.startedAt)) / 60000) })),
    pausedUntil: state?.pausedUntil ?? null,
    tickets: (state?.tickets ?? []).map((t) => ({ key: t.key, phase: t.phase, reviews: t.reviews, pr: t.pr ?? null })),
    costs: Object.values(tickets).sort((a, b) => b.last.localeCompare(a.last)),
    totalCostUsd: Object.values(tickets).reduce((s, t) => s + t.costUsd, 0),
    events,
    polls: { total: acted.length, idle: idle.length, reasons: Object.fromEntries(Object.entries(Object.groupBy(idle, (o) => o.reason)).map(([k, v]) => [k, v.length])) },
    errors: Object.entries(errors).map(([message, count]) => ({ message, count })),
  };
};

const mins = (ms) => `${(ms / 60000).toFixed(1)}m`;

export const render = (s) => {
  const out = [];
  out.push(`RUNNING   ${s.running.length ? s.running.map((r) => `${r.key} ${r.step} (${r.minutes}m)`).join(", ") : "nothing"}${s.pausedUntil ? `   PAUSED until ${s.pausedUntil}` : ""}`);
  out.push("", "TICKETS");
  for (const t of s.tickets) out.push(`  ${t.key.padEnd(8)} ${String(t.phase).padEnd(12)} reviews=${t.reviews ?? 0}${t.pr ? ` pr=${t.pr}` : ""}`);
  out.push("", "COST (finished runs)");
  for (const t of s.costs)
    out.push(`  ${t.key.padEnd(8)} $${t.costUsd.toFixed(2).padStart(6)} ${mins(t.durationMs).padStart(7)} ${String(t.turns).padStart(4)} turns  ${Object.entries(t.steps).map(([k, v]) => `${k}×${v}`).join(" ")}${t.denied ? `  DENIED×${t.denied}` : ""}${t.failedSubagents ? `  SUBAGENT-FAIL×${t.failedSubagents}` : ""}`);
  out.push(`  ${"total".padEnd(8)} $${s.totalCostUsd.toFixed(2).padStart(6)}`);
  if (s.events.length) {
    out.push("", "EVENTS");
    for (const e of s.events.slice(-10)) out.push(`  ${e.at} ${e.event} ${e.reason ?? ""}`);
  }
  out.push("", `POLLS     ${s.polls.total} total, ${s.polls.idle} idle${Object.entries(s.polls.reasons).map(([k, v]) => ` (${k}: ${v})`).join("")}`);
  if (s.errors.length) {
    out.push("", "POLL ERRORS (distinct)");
    for (const e of s.errors) out.push(`  ${String(e.count).padStart(3)}× ${e.message}`);
  }
  return out.join("\n");
};

export const main = (argv = process.argv.slice(2)) => {
  const args = argv.filter((a) => !a.startsWith("--"));
  const sinceAt = argv.indexOf("--since");
  const since = sinceAt >= 0 ? argv[sinceAt + 1] : undefined;
  const dir = args.find((a) => a !== since) ?? process.env.SF_STATE_DIR ?? "/Users/agent/.local/state/software-factory";
  const stateFile = join(dir, "state.json");
  const summary = summarize({
    runs: readRuns(dir, since),
    state: existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null,
    outLines: lines(join(dir, "poll.out.log")),
    errLines: lines(join(dir, "poll.err.log")),
  });
  console.log(argv.includes("--json") ? JSON.stringify(summary, null, 2) : render(summary));
};

if (import.meta.url === `file://${process.argv[1]}`) main();
