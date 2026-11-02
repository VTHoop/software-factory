import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exists, json } from "./lib.mjs";

const rules = () => json("bench", "settings.json").permissions;

describe("bench/settings.json: the access rules for every scored run", () => {
  it("exists and has allow and deny lists", () => {
    assert.ok(exists("bench", "settings.json"), "no bench/settings.json");
    assert.ok(Array.isArray(rules().allow));
    assert.ok(Array.isArray(rules().deny));
  });

  it("denies merging, pushing and writing under .github", () => {
    const deny = rules().deny;
    for (const rule of [
      "Bash(gh pr merge:*)",
      "Bash(git push:*)",
      "Write(.github/**)",
      "Edit(.github/**)",
    ]) {
      assert.ok(deny.includes(rule), rule);
    }
  });

  it("allows what pr-review runs, one command at a time", () => {
    const allow = rules().allow;
    for (const rule of [
      "Bash(git fetch:*)",
      "Bash(git diff:*)",
      "Bash(git show:*)",
      "Bash(git rev-parse:*)",
      "Bash(gh pr view:*)",
      "Bash(gh pr list:*)",
      "Bash(gh pr comment:*)",
      "mcp__linear__get_issue",
    ]) {
      assert.ok(allow.includes(rule), rule);
    }
  });

  it("allows no compound command and nothing it also denies", () => {
    const { allow, deny } = rules();
    for (const rule of allow) assert.doesNotMatch(rule, /&&|;|\|/, rule);
    for (const rule of allow) assert.ok(!deny.includes(rule), rule);
  });

  it("allows no merge, push or general gh api", () => {
    for (const rule of rules().allow) {
      assert.doesNotMatch(rule, /gh pr merge|git push|gh api:\*|gh api \*/, rule);
    }
  });
});
