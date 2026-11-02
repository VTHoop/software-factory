import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const git = (cwd, ...args) => promisify(execFile)("git", args, { cwd }).then((r) => r.stdout.trim());

// Worktrees whose PR is merged or closed. An open, unknown or missing PR keeps its worktree.
export const staleWorktrees = (tickets, prStates) =>
  tickets.filter((t) => t.worktree && t.pr && ["MERGED", "CLOSED"].includes(prStates[t.pr]));

// Detached at the base: start-ticket makes the ticket's branch itself, and stops if it already exists.
export const addWorktree = async ({ repo, branch, base }, root) => {
  await git(repo, "fetch", "origin");
  mkdirSync(root, { recursive: true });
  const path = join(root, `${basename(repo)}-${branch.replaceAll("/", "_")}`);
  await git(repo, "worktree", "add", "--detach", path, `origin/${base}`);
  return path;
};

export const addReviewCheckout = async ({ repo, pr }, root) => {
  mkdirSync(root, { recursive: true });
  const path = join(root, `${basename(repo)}-review-pr-${pr}-${Date.now()}`);
  await git(repo, "fetch", "origin", `pull/${pr}/head`);
  await git(repo, "worktree", "add", "--detach", path, "FETCH_HEAD");
  return path;
};

export const removeWorktree = (repo, path) => git(repo, "worktree", "remove", "--force", path);
