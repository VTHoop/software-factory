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
    assert.match(rules(), /`git show <head>:<path>`/);
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

  it("gives a failed reviewer one more try, naming the files it missed", () => {
    assert.match(text(), /spawn it once more, naming the files it missed/i);
  });

  it("never approves on an incomplete lens in an owner session", () => {
    assert.match(text(), /never `Approved`/);
  });

  it("stops an unattended run when coverage is still incomplete", () => {
    assert.match(block(text(), "unattended"), /incomplete coverage.*stop/is);
  });
});
