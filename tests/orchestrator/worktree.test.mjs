import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanupWorktrees, staleWorktrees } from "../../orchestrator/worktree.mjs";

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

describe("cleanupWorktrees", () => {
  const stale = [
    { key: "HEA-1", pr: 1, worktree: "/wt/1" },
    { key: "HEA-2", pr: 2, worktree: "/wt/2" },
  ];

  it("removes stale worktrees and reports the keys it removed", async () => {
    const removed = [];
    const keys = await cleanupWorktrees(stale, {
      prState: async (pr) => (pr === 3 ? "OPEN" : "MERGED"),
      remove: async (t) => void removed.push(t.worktree),
    });
    assert.deepEqual(keys, ["HEA-1", "HEA-2"]);
    assert.deepEqual(removed, ["/wt/1", "/wt/2"]);
  });

  it("does not report a worktree whose removal failed, so it is tried again", async () => {
    const keys = await cleanupWorktrees(stale, {
      prState: async () => "CLOSED",
      remove: async (t) => {
        if (t.key === "HEA-1") throw new Error("busy");
      },
    });
    assert.deepEqual(keys, ["HEA-2"]);
  });

  it("keeps the worktree of an open PR, and of a ticket with no PR", async () => {
    const keys = await cleanupWorktrees(
      [{ key: "A", pr: 1, worktree: "/a" }, { key: "B", pr: null, worktree: "/b", phase: "escalated" }],
      { prState: async () => "OPEN", remove: async () => assert.fail("removed") },
    );
    assert.deepEqual(keys, []);
  });

  it("keeps a ticket's worktree when GitHub can't say what its PR state is", async () => {
    const keys = await cleanupWorktrees(stale, {
      prState: async () => {
        throw new Error("network");
      },
      remove: async () => assert.fail("removed"),
    });
    assert.deepEqual(keys, []);
  });
});
