import { mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { exec } from "./exec.mjs";

const git = (cwd, env, ...args) => exec("git", args, { cwd, env }).then((r) => r.stdout.trim());

// Worktrees whose PR is merged or closed. An open, unknown or missing PR keeps its worktree.
export const staleWorktrees = (tickets, prStates) =>
  tickets.filter((t) => t.worktree && t.pr && ["MERGED", "CLOSED"].includes(prStates[t.pr]));

// Detached at the base: start-ticket makes the ticket's branch itself, and stops if it already exists.
export const addWorktree = async ({ repo, branch, base }, root, env) => {
  await git(repo, env, "fetch", "origin");
  mkdirSync(root, { recursive: true });
  const path = join(root, `${basename(repo)}-${branch.replaceAll("/", "_")}`);
  // An earlier attempt may have left this path behind, listed by git or not.
  await git(repo, env, "worktree", "remove", "--force", path).catch(() => {});
  rmSync(path, { recursive: true, force: true });
  await git(repo, env, "worktree", "prune");
  await git(repo, env, "worktree", "add", "--detach", path, `origin/${base}`);
  return path;
};

export const addReviewCheckout = async ({ repo, pr }, root, env) => {
  mkdirSync(root, { recursive: true });
  const path = join(root, `${basename(repo)}-review-pr-${pr}-${Date.now()}`);
  // Into a named ref, because FETCH_HEAD moves with the next fetch in the repo.
  const ref = `refs/factory/pr-${pr}`;
  await git(repo, env, "fetch", "origin", `+pull/${pr}/head:${ref}`);
  await git(repo, env, "worktree", "add", "--detach", path, ref);
  return path;
};

export const removeWorktree = (repo, path) => git(repo, undefined, "worktree", "remove", "--force", path);

export const pruneWorktrees = (repo) => git(repo, undefined, "worktree", "prune");

// Removes the worktrees of merged or closed PRs. Returns the keys it removed; a worktree
// that fails to go, or whose PR state can't be read, stays and is tried again next poll.
export const cleanupWorktrees = async (tickets, { prState, remove }) => {
  const states = {};
  for (const t of tickets) {
    if (!t.worktree || !t.pr) continue;
    try {
      states[t.pr] = await prState(t.pr, t);
    } catch {}
  }
  const removed = [];
  for (const t of staleWorktrees(tickets, states)) {
    try {
      await remove(t);
      removed.push(t.key);
    } catch {}
  }
  return removed;
};
