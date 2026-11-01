import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AGENTS, agent, block, skill } from "./lib.mjs";

const text = () => skill("pr-review");
const prompt = () => block(text(), "reviewer-prompt");
const focus = () => block(text(), "reviewer-focus");

describe("pr-review defines the reviewer prompt", () => {
  it("has one fixed prompt for the session to fill in", () => {
    assert.ok(prompt(), "no reviewer-prompt block");
  });

  it("fixes the wording for the checkout and the origin/ refs", () => {
    assert.match(prompt(), /checkout at <checkout>/);
    assert.match(prompt(), /`origin\/<base>`.*`origin\/<head>`.*never a local branch name/is);
    assert.match(prompt(), /`git diff origin\/<base>\.\.\.origin\/<head>`/);
  });

  it("fixes the wording for the changed files and the reading rules", () => {
    assert.match(prompt(), /^Changed files \(<m>\):$/m);
    assert.match(prompt(), /read every file in the changed-file list in full/i);
    assert.match(prompt(), /`git show origin\/<head>:<path>`/);
    assert.match(prompt(), /`--stat`.*keyword grep.*do(es)? not count/is);
  });

  it("uses the same reading rule as the agents' review-depth block", () => {
    for (const a of AGENTS) {
      assert.match(agent(a), /read every file in the changed-file list in full/i, a);
    }
  });

  it("is used word for word, with only the placeholders and the focus filled in", () => {
    assert.match(text(), /every reviewer.*reviewer prompt.*word for word/is);
    assert.match(text(), /only the placeholders/i);
  });
});

describe("every reviewer prompt has a focus", () => {
  it("makes the Focus line part of the fixed prompt", () => {
    assert.match(prompt(), /^Focus: <.+>$/m);
  });

  it("writes the focus from what this PR changes, in a line or two", () => {
    assert.ok(focus(), "no reviewer-focus block");
    assert.match(focus(), /written from what this PR changes/i);
    assert.match(focus(), /one or two lines/i);
  });

  it("never spawns a reviewer without a focus", () => {
    assert.match(focus(), /do not spawn a reviewer without a Focus line/i);
  });

  it("keeps the focus general: no finding from the answer key is named", () => {
    const key =
      /stale|trust rule|gh pr create|quoting|injection|rerun|twice|hard-?code|README|step numbers|flywheel|AngularJS|drone|pluginDir|heading style|stop-list/i;
    assert.doesNotMatch(prompt(), key);
    assert.doesNotMatch(focus(), key);
  });
});

describe("pr-review compares the paths each reviewer read", () => {
  it("asks for the paths read, one per line, after the Files read lines", () => {
    assert.match(prompt(), /^Read paths:$/m);
    assert.match(prompt(), /one path per line/i);
    assert.match(prompt(), /only files you opened in full/i);
  });

  it("compares those paths with the changed-file list, not the totals", () => {
    assert.match(text(), /compare.*`Read paths:`.*paths.*changed-file list/is);
    assert.match(text(), /matching total is not enough/i);
  });

  it("counts a file read through the diff, or not opened in full, as not read", () => {
    assert.match(text(), /through the diff|not opened in full/i);
    assert.match(text(), /counts as not read/i);
  });

  it("sends a reviewer with unread files back once, naming them", () => {
    assert.match(text(), /spawn it once more, naming the files it missed/i);
    assert.match(text(), /never `Approved`/);
  });

  it("never asks an agent to recount its earlier reasoning", () => {
    assert.doesNotMatch(text(), /recount|recall your (earlier )?reasoning|explain your earlier/i);
  });
});
