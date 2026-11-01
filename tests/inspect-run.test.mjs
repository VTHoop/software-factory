import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { block, root, skill } from "./lib.mjs";

const { inspectRun, fixedLines } = await import("../bench/inspect-run.mjs");

const TEMPLATE = `<!-- reviewer-prompt:start -->
Review PR #<n> in the checkout at <checkout>.
Use origin/<base> and origin/<head>, never a local branch name.
Changed files:
<paths>
Read every changed file in full.
Focus: <one or two lines>
<reviewer inputs>
End with the \`Read paths:\` list.
<!-- reviewer-prompt:end -->`;

const promptFor = (focus, { skip = [] } = {}) =>
  [
    "Review PR #32 in the checkout at /work/clone.",
    "Use origin/main and origin/feature, never a local branch name.",
    "Changed files:",
    "README.md",
    "plugins/x/SKILL.md",
    "Read every changed file in full.",
    focus === null ? null : `Focus: ${focus}`,
    "End with the `Read paths:` list.",
  ]
    .filter((l) => l !== null && !skip.includes(l))
    .join("\n");

const LENSES = [
  "software-factory:sdlc-review-quality",
  "software-factory:sdlc-review-performance",
];
const FOCUS = {
  [LENSES[0]]: "Shell snippets in the skill text: quoting of values taken from tickets.",
  [LENSES[1]]: "Loops and retries in the skill workflows that have no stop condition.",
};

let n = 0;
const spawn = (id, type, prompt) => ({
  type: "assistant",
  message: {
    content: [{ type: "tool_use", id, name: "Agent", input: { subagent_type: type, description: type, prompt } }],
  },
});
const call = (parent, name, input) => ({
  type: "assistant",
  parent_tool_use_id: parent,
  message: { content: [{ type: "tool_use", id: `t${n++}`, name, input }] },
});
const init = { type: "system", subtype: "init", cwd: "/work/clone" };
const result = (extra = {}) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  permission_denials: [],
  ...extra,
});
const stream = (...events) => events.map((e) => JSON.stringify(e)).join("\n");

const goodRun = () =>
  stream(
    init,
    ...LENSES.map((l, i) => spawn(`a${i}`, l, promptFor(FOCUS[l]))),
    call("a0", "Read", { file_path: "/work/clone/README.md" }),
    call("a0", "Bash", { command: "git show origin/feature:plugins/x/SKILL.md" }),
    call("a0", "Bash", { command: "git diff origin/main...origin/feature --name-only" }),
    call("a1", "Read", { file_path: "/work/clone/README.md", limit: 20 }),
    result(),
  );

describe("inspectRun: reviewer spawns", () => {
  it("lists each reviewer spawn with its type and prompt", () => {
    const r = inspectRun(goodRun(), TEMPLATE);
    assert.deepEqual(
      r.reviewers.map((x) => x.type),
      LENSES,
    );
    assert.match(r.reviewers[0].prompt, /^Review PR #32/);
    assert.equal(r.subagentCount, 2);
  });

  it("ignores spawns that are not review agents", () => {
    const run = stream(init, spawn("s0", "general-purpose", "do a thing"), result());
    assert.equal(inspectRun(run, TEMPLATE).reviewers.length, 0);
  });
});

describe("inspectRun: fixed wording", () => {
  it("passes when a prompt has every fixed line", () => {
    const r = inspectRun(goodRun(), TEMPLATE);
    assert.deepEqual(r.reviewers.map((x) => x.missingLines), [[], []]);
    assert.ok(r.reviewers.every((x) => x.fixedWording));
  });

  it("fails a prompt that drops a fixed line, and says which", () => {
    const dropped = "Read every changed file in full.";
    const run = stream(
      init,
      spawn("a0", LENSES[0], promptFor(FOCUS[LENSES[0]], { skip: [dropped] })),
      result(),
    );
    const [rev] = inspectRun(run, TEMPLATE).reviewers;
    assert.equal(rev.fixedWording, false);
    assert.deepEqual(rev.missingLines, [dropped]);
  });

  it("takes the fixed lines from the template, leaving out placeholder-only lines and the focus", () => {
    const lines = fixedLines(TEMPLATE);
    assert.ok(lines.some((l) => l.startsWith("Review PR #")));
    assert.ok(!lines.some((l) => l.startsWith("Focus:")));
    assert.ok(!lines.includes("<paths>"));
  });

  it("works with the block in the real pr-review skill", () => {
    const lines = fixedLines(block(skill("pr-review"), "reviewer-prompt") ?? "");
    assert.ok(lines.length > 3, "the skill has no usable reviewer-prompt block");
  });
});

describe("inspectRun: focus", () => {
  it("passes a focus written for the PR", () => {
    assert.ok(inspectRun(goodRun(), TEMPLATE).reviewers.every((x) => x.focus));
  });

  it("fails a prompt with no Focus line", () => {
    const run = stream(init, spawn("a0", LENSES[0], promptFor(null)), result());
    assert.equal(inspectRun(run, TEMPLATE).reviewers[0].focus, false);
  });

  it("fails a focus that is a placeholder or too short to say anything", () => {
    for (const f of ["<one or two lines>", "Review it."]) {
      const run = stream(init, spawn("a0", LENSES[0], promptFor(f)), result());
      assert.equal(inspectRun(run, TEMPLATE).reviewers[0].focus, false, f);
    }
  });

  it("fails reviewers that all got the same focus", () => {
    const same = "Check everything in this change carefully for problems.";
    const run = stream(
      init,
      ...LENSES.map((l, i) => spawn(`a${i}`, l, promptFor(same))),
      result(),
    );
    assert.ok(inspectRun(run, TEMPLATE).reviewers.every((x) => x.focus === false));
  });
});

describe("inspectRun: files each reviewer opened", () => {
  it("lists files opened in full, whether by Read or git show, relative to the checkout", () => {
    const [quality] = inspectRun(goodRun(), TEMPLATE).reviewers;
    assert.deepEqual(quality.opened, ["README.md", "plugins/x/SKILL.md"]);
  });

  it("does not count a diff as opening a file", () => {
    const [quality] = inspectRun(goodRun(), TEMPLATE).reviewers;
    assert.ok(!quality.opened.includes("--name-only"));
    assert.equal(quality.opened.length, 2);
  });

  it("puts a partial read in its own list, not in opened", () => {
    const [, perf] = inspectRun(goodRun(), TEMPLATE).reviewers;
    assert.deepEqual(perf.opened, []);
    assert.deepEqual(perf.partial, ["README.md"]);
  });

  it("treats git show piped through head as partial", () => {
    const run = stream(
      init,
      spawn("a0", LENSES[0], promptFor(FOCUS[LENSES[0]])),
      call("a0", "Bash", { command: "git show origin/feature:README.md | head -40" }),
      result(),
    );
    const [rev] = inspectRun(run, TEMPLATE).reviewers;
    assert.deepEqual(rev.opened, []);
    assert.deepEqual(rev.partial, ["README.md"]);
  });

  it("says the skill cannot fully verify reads by itself", () => {
    assert.match(inspectRun(goodRun(), TEMPLATE).limits, /cannot fully verify/i);
  });
});

describe("inspectRun: run health", () => {
  it("reports permission denials from the result", () => {
    const denied = [{ tool_name: "Bash", tool_input: { command: "H=origin/main && git diff" } }];
    const run = stream(init, result({ permission_denials: denied }));
    const r = inspectRun(run, TEMPLATE);
    assert.equal(r.denials.length, 1);
    assert.equal(r.denials[0].tool_name, "Bash");
  });

  it("reports no denials on a clean run", () => {
    assert.deepEqual(inspectRun(goodRun(), TEMPLATE).denials, []);
  });
});

describe("bench/inspect-run.mjs on the command line", () => {
  const dir = mkdtempSync(join(tmpdir(), "inspect-run-"));
  const templateFile = join(dir, "SKILL.md");
  writeFileSync(templateFile, `# Skill\n\n${TEMPLATE}\n`);
  const run = (events) => {
    const file = join(dir, `run-${n++}.jsonl`);
    writeFileSync(file, events);
    return spawnSync(
      "node",
      [join(root, "bench", "inspect-run.mjs"), file, "--skill", templateFile],
      { encoding: "utf8" },
    );
  };

  it("prints the report as JSON and exits 0 when every check holds", () => {
    const out = run(goodRun());
    assert.equal(out.status, 0, out.stderr);
    assert.equal(JSON.parse(out.stdout).reviewers.length, 2);
  });

  it("exits 1 when a prompt lacks the fixed wording or a focus", () => {
    const bad = stream(init, spawn("a0", LENSES[0], promptFor(null)), result());
    assert.equal(run(bad).status, 1);
  });

  it("exits 1 when there is a permission denial", () => {
    const denied = stream(
      init,
      ...LENSES.map((l, i) => spawn(`a${i}`, l, promptFor(FOCUS[l]))),
      result({ permission_denials: [{ tool_name: "Bash" }] }),
    );
    assert.equal(run(denied).status, 1);
  });
});
