import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, sep } from "node:path";
import { buildSettings, settingsFile } from "./claude.mjs";

// The pieces cli.mjs hands to other modules, kept here so tests can check what a run actually receives.
export const settingsFor = (entry, config, step) =>
  buildSettings(entry, { base: config.base, keyFile: config.githubApp?.privateKeyFile, review: step === "review" });

// Writes a repo's two settings files and returns the one for a step: only review runs deny posting.
export const writeSettings = (stateDir, entry, config) => {
  mkdirSync(stateDir, { recursive: true });
  const files = {};
  for (const step of ["other", "review"]) {
    files[step] = settingsFile(stateDir, entry.repo, step);
    writeFileSync(files[step], JSON.stringify(settingsFor(entry, config, step)));
  }
  return (step) => files[step === "review" ? "review" : "other"];
};

const missing = (error) => {
  if (error.code !== "ENOENT") throw error;
  return null;
};

// Whether the file's directory resolves to somewhere inside the checkout.
const inside = (path, root) => {
  const real = realpathSync(root);
  try {
    const dir = realpathSync(dirname(path));
    return dir === real || dir.startsWith(real + sep);
  } catch (error) {
    return missing(error) ?? false;
  }
};

// The review file sits in a checkout the run controls, so neither call follows a symlink out of it.
export const reviewFiles = {
  // Removing the file's whole directory takes out a symlink as a link, without following it.
  remove: (path, root) => {
    const dir = dirname(path);
    if (!dir.startsWith(root + sep)) throw new Error(`${path} is not below ${root}`);
    rmSync(dir, { recursive: true, force: true });
  },
  read: (path, root) => {
    if (!inside(path, root)) return null;
    try {
      return lstatSync(path).isFile() ? readFileSync(path, "utf8") : null;
    } catch (error) {
      return missing(error);
    }
  },
};

const withToken = (identity) => identity && (() => ({ ...process.env, ...identity.callEnv() }));

// `env` is a function, called on every gh call, so a token that has expired stops the call.
export const githubConfigFor = (entry, config, identity) => ({
  githubRepo: entry.githubRepo,
  trustedAuthors: config.trustedAuthors,
  previewAuthors: config.previewAuthors,
  appLogin: config.githubApp?.botLogin,
  env: withToken(identity),
});

// A run only starts on a token minted within the last 30 minutes.
export const claudeEnv = (identity) => ({ ...process.env, ...identity?.env() });

// The script's own git calls (fetching for a worktree) take the token without it entering process.env.
export const gitEnv = (identity) => withToken(identity)?.();
