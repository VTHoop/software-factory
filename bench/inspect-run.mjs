#!/usr/bin/env node
// Reads the stream-json output of a headless `pr-review` run and reports what
// the reviewers were told and what they opened. Usage:
//   node bench/inspect-run.mjs <stream.jsonl> --skill <pr-review SKILL.md>
// Exits 1 when a reviewer prompt lacks the fixed wording or a focus, or the
// run has a permission denial.

import { readFileSync } from "node:fs";

const REVIEW_AGENT = /^software-factory:sdlc-review-/;
const MIN_FOCUS = 30;

export const LIMITS =
  "Reads are inferred from the reviewers' Read and git show calls in the stream. " +
  "The skill cannot fully verify reads by itself: a reviewer can open a file and still skim it.";

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The template's lines, each as a regex with every <placeholder> as a wildcard.
// Lines that are only a placeholder, the focus line and the markers are left out.
export const fixedLines = (template) =>
  template
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("<!--") && !/^<[^>]+>$/.test(l) && !l.startsWith("Focus:"));

const lineMatcher = (line) =>
  new RegExp(`^${line.split(/<[^>]+>/).map(escape).join(".+")}$`, "m");

const events = (text) =>
  text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

const toolUses = (e) =>
  (e.message?.content ?? []).filter((c) => c.type === "tool_use");

const relative = (path, cwd) =>
  cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;

// What a Read or Bash call opened: { path, full } or null.
const opened = (use, cwd) => {
  if (use.name === "Read") {
    const path = relative(use.input.file_path ?? "", cwd);
    return path ? { path, full: use.input.limit === undefined && use.input.offset === undefined } : null;
  }
  if (use.name === "Bash") {
    const cmd = use.input.command ?? "";
    const m = cmd.match(/git show origin\/[^\s:]+:([^\s|;&]+)/);
    return m ? { path: m[1], full: !/[|;&]/.test(cmd) } : null;
  }
  return null;
};

export function inspectRun(text, template) {
  const evs = events(text);
  const cwd = evs.find((e) => e.type === "system" && e.subtype === "init")?.cwd;
  const lines = fixedLines(template).map((line) => ({ line, re: lineMatcher(line) }));

  const reviewers = [];
  const byId = new Map();
  for (const e of evs) {
    if (e.type !== "assistant" || e.parent_tool_use_id) continue;
    for (const use of toolUses(e)) {
      if (!["Agent", "Task"].includes(use.name)) continue;
      const type = use.input?.subagent_type ?? "";
      if (!REVIEW_AGENT.test(type)) continue;
      const prompt = use.input.prompt ?? "";
      const missingLines = lines.filter(({ re }) => !re.test(prompt)).map(({ line }) => line);
      const r = {
        type,
        prompt,
        fixedWording: missingLines.length === 0,
        missingLines,
        focusText: prompt.match(/^Focus: (.+)$/m)?.[1] ?? "",
        focus: false,
        opened: new Set(),
        partial: new Set(),
      };
      reviewers.push(r);
      byId.set(use.id, r);
    }
  }

  for (const e of evs) {
    const r = byId.get(e.parent_tool_use_id);
    if (e.type !== "assistant" || !r) continue;
    for (const use of toolUses(e)) {
      const o = opened(use, cwd);
      if (o) (o.full ? r.opened : r.partial).add(o.path);
    }
  }

  const counts = new Map();
  for (const r of reviewers) counts.set(r.focusText, (counts.get(r.focusText) ?? 0) + 1);
  for (const r of reviewers) {
    r.focus =
      r.focusText.length >= MIN_FOCUS && !/<[^>]+>/.test(r.focusText) && counts.get(r.focusText) === 1;
    r.opened = [...r.opened].sort();
    // A file read in full later is not partial.
    r.partial = [...r.partial].filter((p) => !r.opened.includes(p)).sort();
    delete r.focusText;
  }

  const result = evs.findLast((e) => e.type === "result");
  return {
    reviewers,
    subagentCount: reviewers.length,
    denials: result?.permission_denials ?? [],
    limits: LIMITS,
  };
}

const passes = (r) =>
  r.denials.length === 0 && r.reviewers.every((x) => x.fixedWording && x.focus);

if (import.meta.main) {
  const [file, flag, skillFile] = process.argv.slice(2);
  if (!file || flag !== "--skill" || !skillFile) {
    console.error("usage: inspect-run.mjs <stream.jsonl> --skill <pr-review SKILL.md>");
    process.exit(2);
  }
  const skill = readFileSync(skillFile, "utf8");
  const start = skill.indexOf("<!-- reviewer-prompt:start -->");
  const end = skill.indexOf("<!-- reviewer-prompt:end -->");
  const template = start === -1 || end === -1 ? "" : skill.slice(start, end);
  const report = inspectRun(readFileSync(file, "utf8"), template);
  console.log(JSON.stringify(report, null, 2));
  process.exit(passes(report) ? 0 : 1);
}
