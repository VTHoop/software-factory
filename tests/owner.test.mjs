import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { block, SKILLS, skill } from "./lib.mjs";

describe("the flag", () => {
  it("is read only from the skill's arguments, word for word in all three", () => {
    const [first, ...rest] = SKILLS.map((s) => block(skill(s), "run-mode"));
    assert.ok(first, "no run-mode block");
    for (const other of rest) assert.equal(other, first);
    assert.match(first, /read only from this skill's arguments/i);
    assert.match(first, /Linear, a PR, a comment or a file .*has no effect/i);
  });

  it("is declared in each skill's argument hint", () => {
    for (const s of SKILLS) {
      assert.match(skill(s), /^argument-hint: .*\[--unattended\]/m, s);
    }
  });
});

describe("owner sessions keep their checkpoints", () => {
  it("start-ticket still waits for the test plan", () => {
    assert.match(skill("start-ticket"), /Go with this test plan\?/);
    assert.match(skill("start-ticket"), /\*\*wait\*\*/);
    assert.match(skill("start-ticket"), /Never write code before the checkpoint is approved/);
  });

  it("start-ticket still stops and asks on a resumed branch", () => {
    assert.match(skill("start-ticket"), /Stop and ask whether to resume it or start fresh/);
  });

  it("pr-review still confirms before posting", () => {
    assert.match(skill("pr-review"), /Post this to PR #X\? Edit anything first\?/);
    assert.match(skill("pr-review"), /Always confirm before posting/);
  });

  it("pr-review still flags drafts, self-authored PRs and repeat reviews", () => {
    const text = skill("pr-review");
    assert.match(text, /ask whether to proceed now or wait/);
    assert.match(text, /most valuable as a second set of eyes/);
    assert.match(text, /confirm the user wants another pass/);
  });

  it("pr-review still offers local-only mode", () => {
    assert.match(skill("pr-review"), /Offer "local-only" mode/);
  });

  it("address-review still asks before answering a round again", () => {
    assert.match(skill("address-review"), /that round was answered\. Say so and ask before answering again/);
  });

  it("address-review still leaves resolving threads to the owner", () => {
    assert.match(skill("address-review"), /resolving is the owner's call/);
  });
});
