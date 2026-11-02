import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { staleWorktrees } from "../../orchestrator/worktree.mjs";

const tickets = [
  { key: "HEA-1", pr: 1, worktree: "/wt/1" },
  { key: "HEA-2", pr: 2, worktree: "/wt/2" },
  { key: "HEA-3", pr: 3, worktree: "/wt/3" },
  { key: "HEA-4", pr: null, worktree: "/wt/4" },
];

describe("staleWorktrees", () => {
  it("removes a worktree once its PR is merged or closed", () => {
    const states = { 1: "MERGED", 2: "CLOSED", 3: "OPEN" };
    assert.deepEqual(staleWorktrees(tickets, states).map((t) => t.key), ["HEA-1", "HEA-2"]);
  });

  it("keeps a worktree whose PR is open or whose state is unknown", () => {
    assert.deepEqual(staleWorktrees(tickets, { 3: "OPEN" }), []);
  });

  it("keeps the worktree of a ticket with no PR yet", () => {
    assert.ok(!staleWorktrees(tickets, { 1: "MERGED" }).some((t) => t.key === "HEA-4"));
  });
});
