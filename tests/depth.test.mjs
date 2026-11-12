import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AGENTS, agent, block, skill } from "./lib.mjs";

describe("every reviewer reads what it reviews", () => {
  const rules = () => block(agent(AGENTS[0]), "review-depth");

  it("has the same rules, word for word, in all six", () => {
    assert.ok(rules(), "no review-depth block");
    for (const a of AGENTS) assert.equal(block(agent(a), "review-depth"), rules(), a);
  });

  it("reads every changed file in full, and a diff or grep doesn't count", () => {
    assert.match(rules(), /read every file in the changed-file list in full/i);
    assert.match(rules(), /`git show origin\/<head>:<path>`/);
    assert.match(rules(), /`--stat`.*keyword grep.*do(es)? not count/is);
  });

  it("counts prose as seriously as code", () => {
    assert.match(rules(), /skills?, docs? and config/i);
  });

  it("reports coverage, even on an LGTM", () => {
    assert.match(rules(), /^Files read: <n> of <m>$/m);
    assert.match(rules(), /^Not read: <paths, or none>$/m);
    assert.match(rules(), /every report, including an LGTM/i);
  });

  it("never moves the shared checkout", () => {
    assert.match(rules(), /never run `git checkout`, `git switch`, `git reset` or `git stash`/i);
  });

  it("has no output format that forbids the coverage lines", () => {
    for (const a of AGENTS) assert.doesNotMatch(agent(a), /return exactly/i, a);
  });
});

describe("pr-review checks coverage", () => {
  const text = () => skill("pr-review");

  it("tells each reviewer in its spawn prompt to read every file in full", () => {
    assert.match(text(), /spawn prompt.*read every changed file in full/is);
  });

  it("treats a report without full coverage as a failed reviewer, LGTM or not", () => {
    assert.match(text(), /an LGTM without full coverage is a failed reviewer/i);
  });

  it("covers a few missed files itself instead of spawning the reviewer again", () => {
    assert.match(text(), /missed a few files is not spawned again/i);
    assert.match(text(), /read the files it missed in full yourself/i);
  });

  it("spawns again only a reviewer that mostly failed, naming the files it missed", () => {
    assert.match(text(), /no `Read paths:` list, or missed more than half of the changed files/i);
    assert.match(text(), /spawn it once more, naming the files it missed/i);
  });

  it("reads the lens's agent definition before covering files under it", () => {
    assert.match(text(), /read that reviewer's agent definition/i);
    assert.match(text(), /`\$\{CLAUDE_PLUGIN_ROOT\}\/agents\/<agent>\.md`/);
  });

  it("reads a file several reviewers missed once, then applies each of their lenses", () => {
    assert.match(text(), /several reviewers missed the same file, read it once/i);
  });

  it("puts a Blocker the orchestrator found while covering files before a skeptic", () => {
    assert.match(text(), /Blocker you raised while covering a reviewer's files always goes to a skeptic/i);
  });

  it("reads the files a reviewer still missed itself, under that reviewer's lens", () => {
    assert.match(text(), /read the files it still missed in full yourself/i);
    assert.match(text(), /under that reviewer's lens/i);
  });

  it("withholds Approved only for a file nobody read in full", () => {
    assert.match(text(), /neither the reviewer nor you read in full/i);
    assert.match(text(), /never `Approved`/);
  });

  it("does not stop an unattended run for incomplete coverage, because the arbiter covers it", () => {
    const unattended = block(text(), "unattended");
    assert.doesNotMatch(unattended, /incomplete coverage after its second try, is a stop/i);
    assert.match(unattended, /incomplete coverage after its second try is not a stop/i);
  });

  it("does not count covering a reviewer's missed files as reviewing in its place", () => {
    assert.match(block(text(), "unattended"), /covering the files a reviewer missed.*is not reviewing in its place/is);
  });
});
