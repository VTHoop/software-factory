import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addReviewCheckout, addWorktree, cleanupWorktrees, staleWorktrees } from "../../orchestrator/worktree.mjs";
import { tmp } from "./fakes.mjs";

const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();

// A bare origin with one commit on main, and a clone of it.
const repos = () => {
  const base = tmp("sf-git-");
  const origin = join(base, "origin.git");
  const repo = join(base, "repo");
  mkdirSync(origin);
  git(origin, "init", "-q", "--bare", "-b", "main");
  git(base, "clone", "-q", origin, repo);
  writeFileSync(join(repo, "a.txt"), "a");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "push", "-q", "origin", "HEAD:main");
  return { base, origin, repo, root: join(base, "worktrees") };
};

describe("addWorktree", () => {
  it("creates a detached worktree at the base", async () => {
    const { repo, root } = repos();
    const path = await addWorktree({ repo, branch: "u/hea-1-x", base: "main" }, root);
    assert.equal(git(path, "rev-parse", "HEAD"), git(repo, "rev-parse", "origin/main"));
  });

  it("replaces a worktree left at the same path by an earlier attempt", async () => {
    const { repo, root } = repos();
    const first = await addWorktree({ repo, branch: "u/hea-1-x", base: "main" }, root);
    writeFileSync(join(first, "leftover.txt"), "x");
    const second = await addWorktree({ repo, branch: "u/hea-1-x", base: "main" }, root);
    assert.equal(second, first);
    assert.ok(!existsSync(join(second, "leftover.txt")));
  });

  it("replaces a directory that git no longer lists as a worktree", async () => {
    const { repo, root } = repos();
    const path = await addWorktree({ repo, branch: "u/hea-1-x", base: "main" }, root);
    git(repo, "worktree", "remove", "--force", path);
    mkdirSync(path);
    writeFileSync(join(path, "stray.txt"), "x");
    assert.equal(await addWorktree({ repo, branch: "u/hea-1-x", base: "main" }, root), path);
    assert.ok(!existsSync(join(path, "stray.txt")));
  });
});

describe("addReviewCheckout", () => {
  it("checks out the PR head from a named ref, which another fetch cannot move", async () => {
    const { origin, repo, root } = repos();
    const sha = git(repo, "rev-parse", "HEAD");
    git(origin, "update-ref", "refs/pull/1/head", sha);
    const path = await addReviewCheckout({ repo, pr: 1 }, root);
    assert.equal(git(path, "rev-parse", "HEAD"), sha);
    assert.equal(git(repo, "rev-parse", "refs/factory/pr-1"), sha);
  });
});

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
