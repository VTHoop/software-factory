import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { block, SKILLS, skill } from "./lib.mjs";

const unattended = (name) => {
  const text = block(skill(name), "unattended");
  assert.ok(text, `${name} has no unattended section`);
  return text;
};

describe("structured result", () => {
  it("is word for word the same in all three skills", () => {
    const [first, ...rest] = SKILLS.map((s) => block(skill(s), "unattended-result"));
    assert.ok(first, "no unattended-result block");
    for (const other of rest) assert.equal(other, first);
  });

  it("gives a status of finished or stopped, and the reason if stopped", () => {
    const text = block(skill("start-ticket"), "unattended-result");
    assert.ok(text.includes('SOFTWARE_FACTORY_RESULT: {"status":"finished"}'));
    assert.ok(text.includes('SOFTWARE_FACTORY_RESULT: {"status":"stopped","reason":"'));
    assert.match(text, /last line/i);
  });

  it("posts no escalation comment or label on a stop", () => {
    const text = block(skill("start-ticket"), "unattended-result");
    assert.match(text, /no escalation comment or label/i);
  });

  it("never waits for an answer", () => {
    const text = block(skill("start-ticket"), "unattended-result");
    assert.match(text, /never wait/i);
  });
});

describe("start-ticket --unattended", () => {
  const text = () => unattended("start-ticket");

  it("posts the AC → test table and approach to Linear instead of waiting", () => {
    assert.match(text(), /AC → test table and the approach/);
    assert.match(text(), /`save_comment`/);
    assert.match(text(), /do not wait for approval/i);
  });

  it("then implements test-first", () => {
    assert.match(text(), /first commit is the failing tests/i);
  });

  it("runs the project's verification commands before opening a PR", () => {
    assert.match(text(), /run every command .*`## Verification`.* before opening a PR/i);
  });

  it("opens a non-draft PR on the Linear branch with the key in the title", () => {
    assert.match(text(), /non-draft PR/i);
    assert.match(text(), /Linear branch name/i);
    assert.match(text(), /issue key in the title/i);
    assert.doesNotMatch(text(), /--draft/);
  });

  it("has the fixed manual-test heading with a checklist and pre-test steps", () => {
    assert.match(text(), /^\s*## Owner manual test$/m);
    assert.match(text(), /^\s*### Before testing$/m);
    assert.match(text(), /^\s*### Checklist$/m);
    assert.match(text(), /migration to apply/i);
    assert.match(text(), /env var to add/i);
    assert.match(text(), /real-key check/i);
  });

  it("ends each stop condition in a stopped result and opens no PR", () => {
    for (const condition of [
      /uncommitted/i,
      /own commits/i,
      /branch already exists/i,
      /Linear is unreachable/i,
      /Done or Canceled/i,
      /In Review/i,
      /blocked by/i,
      /contradicts a project document/i,
      /no AC section/i,
      /no `## Verification` section/i,
    ]) {
      assert.match(text(), condition);
    }
    assert.match(text(), /stopped result with the reason.*opens no PR/is);
  });

  it("stops for something only the owner can provide only when the work needs it", () => {
    assert.match(text(), /only if the work can't be implemented and verified without it/i);
    assert.match(text(), /otherwise .*`### Before testing`/i);
  });

  it("keeps the branch local when verification still fails", () => {
    assert.match(text(), /still fails/i);
    assert.match(text(), /open no PR and do not push/i);
    assert.match(text(), /names? the failing commands/i);
    assert.match(text(), /branch stays local/i);
  });

  it("reports a check that can't run locally without calling it passing", () => {
    assert.match(text(), /can't run locally does not stop the run/i);
    assert.match(text(), /never report it as passing/i);
  });

  it("never applies a migration to a hosted database where the owner does that", () => {
    assert.match(text(), /only the owner applies migrations/i);
    assert.match(text(), /never apply it to a hosted database/i);
    assert.match(text(), /local reset used for verification is allowed/i);
  });
});

describe("pr-review --unattended", () => {
  const text = () => unattended("pr-review");

  it("spawns all six however small the diff, never reviewing inline", () => {
    assert.match(text(), /all six review agents, however small the diff/i);
    assert.match(text(), /never review inline in their place/i);
  });

  it("posts the summary without asking, and no inline comments", () => {
    assert.match(text(), /post the summary comment without asking/i);
    assert.match(text(), /no inline comments/i);
  });

  it("continues when already reviewed or authored by the current account", () => {
    assert.match(text(), /already reviewed/i);
    assert.match(text(), /authored by the current account/i);
    assert.match(text(), /continue/i);
  });

  it("stops with the reason on each listed condition", () => {
    for (const condition of [
      /draft/i,
      /merged/i,
      /closed/i,
      /no substantive changes/i,
      /several matching PRs/i,
      /no ticket key/i,
      /Linear is unreachable/i,
      /`gh` failure/i,
    ]) {
      assert.match(text(), condition);
    }
  });

  it("does not skip the requirements reviewer or fall back to local-only", () => {
    assert.match(text(), /never skip the requirements reviewer/i);
    assert.match(text(), /never fall back to local-only/i);
  });

  it("leaves the comment format unchanged", () => {
    const full = skill("pr-review");
    assert.ok(full.includes("*Generated by `/pr-review` · Lenses:"));
    assert.ok(full.includes("**Overall:** [Approved | Needs Revision | Blocked]"));
  });
});

describe("address-review --unattended", () => {
  const text = () => unattended("address-review");

  it("ends every ask in a stopped result", () => {
    for (const condition of [
      /not `OPEN`/,
      /cross-repository/i,
      /another worktree/i,
      /uncommitted changes/i,
      /diverged/i,
      /no trusted review/i,
      /already answered/i,
      /no `## Verification` section/i,
    ]) {
      assert.match(text(), condition);
    }
    assert.match(text(), /stopped result with the reason/i);
  });

  it("still lists deferrals and dismissals for the owner", () => {
    assert.match(text(), /deferred findings and dismissals are still listed/i);
  });

  it("still does not merge, approve, resolve threads or create issues", () => {
    assert.match(text(), /does not merge, approve, resolve threads or create follow-up issues/i);
  });

  it("keeps the rules unchanged", () => {
    const full = skill("address-review");
    assert.match(full, /Never weaken a test, lower a gate, add a suppression, or use `--no-verify`/);
    assert.match(full, /One disposition per finding, and every finding gets one/);
    assert.match(full, /`OWNER`, `MEMBER` or `COLLABORATOR`/);
  });

  it("keeps the response heading unchanged", () => {
    assert.match(skill("address-review"), /^## Response to \/pr-review$/m);
  });
});
