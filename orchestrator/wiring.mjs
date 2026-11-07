import { buildSettings } from "./claude.mjs";

// The pieces cli.mjs hands to other modules, kept here so tests can check what a run actually receives.
export const settingsFor = (entry, config, step) =>
  buildSettings(entry, { base: config.base, keyFile: config.githubApp?.privateKeyFile, review: step === "review" });

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
