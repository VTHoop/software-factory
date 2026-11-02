import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chooseIssue } from "../../orchestrator/choose.mjs";

const config = { projects: ["Software Factory", "Sidekick"] };
const issue = (key, over = {}) => ({
  key,
  status: "Ready",
  project: "Sidekick",
  priority: 3,
  createdAt: "2026-11-01T00:00:00Z",
  labels: [],
  blockedBy: [],
  ...over,
});

describe("chooseIssue", () => {
  it("returns null when nothing is eligible", () => {
    assert.equal(chooseIssue([], config), null);
  });

  it("considers only issues in Ready", () => {
    const issues = [issue("HEA-1", { status: "Todo" }), issue("HEA-2", { status: "In Progress" })];
    assert.equal(chooseIssue(issues, config), null);
  });

  it("considers only configured projects", () => {
    assert.equal(chooseIssue([issue("HEA-1", { project: "Other" })], config), null);
  });

  it("skips an issue labelled needs-owner", () => {
    const issues = [issue("HEA-1", { labels: ["needs-owner"] }), issue("HEA-2")];
    assert.equal(chooseIssue(issues, config).key, "HEA-2");
  });

  it("skips an issue with a blocker that is not Done", () => {
    const blocked = issue("HEA-1", { blockedBy: [{ key: "HEA-9", status: "In Review" }] });
    assert.equal(chooseIssue([blocked], config), null);
  });

  it("takes an issue whose blockers are all Done", () => {
    const free = issue("HEA-1", { blockedBy: [{ key: "HEA-9", status: "Done" }] });
    assert.equal(chooseIssue([free], config).key, "HEA-1");
  });

  it("takes the highest priority first, with 1 urgent and 0 none ranking last", () => {
    const issues = [
      issue("HEA-1", { priority: 0 }),
      issue("HEA-2", { priority: 3 }),
      issue("HEA-3", { priority: 1 }),
    ];
    assert.equal(chooseIssue(issues, config).key, "HEA-3");
    assert.equal(chooseIssue(issues.slice(0, 2), config).key, "HEA-2");
  });

  it("breaks a priority tie with the oldest", () => {
    const issues = [
      issue("HEA-1", { createdAt: "2026-11-02T00:00:00Z" }),
      issue("HEA-2", { createdAt: "2026-10-01T00:00:00Z" }),
    ];
    assert.equal(chooseIssue(issues, config).key, "HEA-2");
  });

  it("is pure: it does not reorder or change its input", () => {
    const issues = [issue("HEA-1", { priority: 4 }), issue("HEA-2", { priority: 1 })];
    const before = structuredClone(issues);
    chooseIssue(issues, config);
    assert.deepEqual(issues, before);
  });
});
