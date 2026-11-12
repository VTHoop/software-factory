#!/usr/bin/env node
// Reads the stream-json output of a headless `pr-review` run and reports what
// the reviewers were told and what they opened. Usage:
//   node bench/inspect-run.mjs <stream.jsonl> --skill <pr-review SKILL.md> [--changed <file>]
// --changed is a file with one changed path per line; it lets a read inside a
// shell loop or glob be attributed, and lists what each reviewer never opened.
// Respawned reviewers are reported but do not gate the exit code.
// Exits 1 when a reviewer prompt lacks the fixed wording or a focus, or the
// run has a permission denial.

import { readFileSync } from "node:fs";

const REVIEW_AGENT = /^software-factory:sdlc-review-/;
const MIN_FOCUS = 30;

export const LIMITS =
  "Reads are inferred from the reviewers' Read and git show calls in the stream, and from what they returned. " +
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

const SHOW = /git(?: -C \S+)? show\s/;
// A `git show` that is not piped on to head, sed, grep and the like.
const FULL_SHOW = /git(?: -C \S+)? show\s+\S+\s*(?=;|&&|\n|$|\bdone\b)/;
const LITERAL_SHOW = /git(?: -C \S+)? show\s+origin\/[^\s:]+:([^\s|;&$]+)/g;

const globToRegExp = (token) =>
  new RegExp(
    `^${escape(token)
      .replace(/\\\*/g, "[^/]*")
      .replace(/\\\{([^}\\]*)\\\}/g, (_, alts) => `(${alts.split(",").join("|")})`)}$`,
  );

const globs = (cmd) =>
  [...cmd.matchAll(/[\w.\/{},*-]*[*{][\w.\/{},*-]*/g)].map((m) => globToRegExp(m[0]));

// `for f in a b c; do ... $f ...` becomes one command per word.
const expandLoop = (cmd) => {
  const m = cmd.match(/for (\w+) in ([^;\n]+?);\s*do\b/);
  if (!m) return [cmd];
  const variable = new RegExp(`\\$(?:\\{${m[1]}\\}|${m[1]}\\b)`, "g");
  return m[2].trim().split(/\s+/).map((word) => cmd.replace(variable, word));
};

// The Read tool's line cap when a call names no limit.
const READ_DEFAULT_LIMIT = 2000;

// Each tool result's text, by tool_use id. Streams recorded without results give an empty map.
const toolResults = (evs) => {
  const out = new Map();
  for (const e of evs) {
    if (e.type !== "user") continue;
    for (const c of e.message?.content ?? []) {
      if (c.type !== "tool_result") continue;
      const text = Array.isArray(c.content) ? c.content.map((p) => p.text ?? "").join("\n") : String(c.content ?? "");
      out.set(c.tool_use_id, { text, isError: c.is_error === true });
    }
  }
  return out;
};

// Bash output too large to return is saved to a file, and the call sees only a preview.
const truncated = (text) => /<persisted-output>|Output too large/.test(text);

// The lines a Read returned: { first, last, end }, where `end` says it reached the end of the file.
const page = (use, res) => {
  const numbers = [...res.text.matchAll(/^\s*(\d+)[\t→]/gm)].map((m) => Number(m[1]));
  const first = numbers[0] ?? use.input.offset ?? 1;
  return { first, last: numbers.at(-1) ?? first - 1, end: numbers.length < (use.input.limit ?? READ_DEFAULT_LIMIT) };
};

// Whether a file's pages run from line 1, without a gap, to a page that reached its end.
const coversFile = (pages) => {
  let reached = 0;
  for (const p of [...pages].sort((a, b) => a.first - b.first)) {
    if (p.first > reached + 1) return false;
    reached = Math.max(reached, p.last);
    if (p.end && p.last >= reached) return true;
  }
  return false;
};

// What a Read or Bash call opened: [{ path, full, page? }]. A shell loop is read by
// matching the changed files against the paths and globs in the command, so
// it is an inference: the command text is all the stream shows. Where the stream
// has the call's result, a Read counts by the lines it returned and a git show by
// whether its output came back whole.
const opened = (use, cwd, changed, res) => {
  if (use.name === "Read") {
    const path = relative(use.input.file_path ?? "", cwd);
    if (!path || res?.isError) return [];
    if (res) return [{ path, full: false, page: page(use, res) }];
    const full = use.input.limit === undefined && use.input.offset === undefined;
    return [{ path, full }];
  }
  if (use.name !== "Bash") return [];
  if (res && truncated(res.text)) return opened(use, cwd, changed).map((o) => ({ ...o, full: false }));
  const found = new Map();
  for (const cmd of expandLoop(use.input.command ?? "")) {
    if (!SHOW.test(cmd)) continue;
    const here = new Map();
    for (const m of cmd.matchAll(LITERAL_SHOW)) {
      if (/[*{]/.test(m[1])) continue;
      const after = cmd.slice(m.index + m[0].length).trimStart();
      here.set(m[1], !after.startsWith("|"));
    }
    const fullCmd = FULL_SHOW.test(cmd);
    const res = globs(cmd);
    for (const p of changed ?? []) {
      if (!here.has(p) && (cmd.includes(p) || res.some((re) => re.test(p)))) here.set(p, fullCmd);
    }
    for (const [path, full] of here) found.set(path, found.get(path) || full);
  }
  // With no result to show the output came back whole, a command that printed several
  // files may have been cut to a preview, so none of them counts as read in full.
  const several = found.size > 1 && !res;
  return [...found].map(([path, full]) => ({ path, full: full && !several }));
};

export function inspectRun(text, template, { changed } = {}) {
  const evs = events(text);
  const cwd = evs.find((e) => e.type === "system" && e.subtype === "init")?.cwd;
  const lines = fixedLines(template).map((line) => ({ line, re: lineMatcher(line) }));

  const reviewers = [];
  const byId = new Map();
  const seen = new Set();
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
        respawn: seen.has(type),
        prompt,
        fixedWording: missingLines.length === 0,
        missingLines,
        focusText: prompt.match(/^Focus: (.+)$/m)?.[1] ?? "",
        focus: false,
        opened: new Set(),
        partial: new Set(),
      };
      seen.add(type);
      reviewers.push(r);
      byId.set(use.id, r);
    }
  }

  const results = toolResults(evs);
  const pages = new Map();
  for (const e of evs) {
    const r = byId.get(e.parent_tool_use_id);
    if (e.type !== "assistant" || !r) continue;
    for (const use of toolUses(e)) {
      for (const o of opened(use, cwd, changed, results.get(use.id))) {
        if (o.page) {
          const key = `${e.parent_tool_use_id}\0${o.path}`;
          pages.set(key, [...(pages.get(key) ?? []), o.page]);
          (coversFile(pages.get(key)) ? r.opened : r.partial).add(o.path);
        } else {
          (o.full ? r.opened : r.partial).add(o.path);
        }
      }
    }
  }

  const counts = new Map();
  for (const r of reviewers.filter((x) => !x.respawn)) {
    counts.set(r.focusText, (counts.get(r.focusText) ?? 0) + 1);
  }
  for (const r of reviewers) {
    r.focus =
      r.focusText.length >= MIN_FOCUS &&
      !/<[^>]+>/.test(r.focusText) &&
      (r.respawn || counts.get(r.focusText) === 1);
    r.opened = [...r.opened].sort();
    // A file read in full later is not partial.
    r.partial = [...r.partial].filter((p) => !r.opened.includes(p)).sort();
    if (changed) r.notOpened = changed.filter((p) => !r.opened.includes(p));
    delete r.focusText;
  }

  const result = evs.findLast((e) => e.type === "result");
  return {
    reviewers,
    subagentCount: reviewers.length,
    respawns: reviewers.filter((r) => r.respawn).length,
    // False for a stream recorded without tool results: reads are then inferred from commands alone.
    toolResults: results.size > 0,
    denials: result?.permission_denials ?? [],
    limits: LIMITS,
  };
}

const passes = (r) =>
  r.denials.length === 0 &&
  r.reviewers.filter((x) => !x.respawn).every((x) => x.fixedWording && x.focus);

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const file = args[0];
  const skillFile = flag("--skill");
  if (!file || file.startsWith("--") || !skillFile) {
    console.error("usage: inspect-run.mjs <stream.jsonl> --skill <pr-review SKILL.md> [--changed <file>]");
    process.exit(2);
  }
  const skill = readFileSync(skillFile, "utf8");
  const start = skill.indexOf("<!-- reviewer-prompt:start -->");
  const end = skill.indexOf("<!-- reviewer-prompt:end -->");
  const template = start === -1 || end === -1 ? "" : skill.slice(start, end);
  const changedFile = flag("--changed");
  const changed = changedFile
    ? readFileSync(changedFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
    : undefined;
  const report = inspectRun(readFileSync(file, "utf8"), template, { changed });
  console.log(JSON.stringify(report, null, 2));
  if (!report.toolResults) {
    console.error("This stream has no tool results, so reads are inferred from commands alone, and a command that read several files counts as partial.");
  }
  process.exit(passes(report) ? 0 : 1);
}
