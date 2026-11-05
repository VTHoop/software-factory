import { statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { maskSecrets } from "./checks.mjs";

export const MAX_TOKEN_AGE_MS = 30 * 60_000;

export const botEmail = (app) => `${app.botUserId}+${app.botLogin}@users.noreply.github.com`;

// The environment gh, git and the runs inherit. git gets the token from gh's credential
// helper, so it never appears in a remote URL, a git setting or a log.
export const githubEnv = (app, token) => ({
  GH_TOKEN: token,
  GIT_AUTHOR_NAME: app.botLogin,
  GIT_AUTHOR_EMAIL: botEmail(app),
  GIT_COMMITTER_NAME: app.botLogin,
  GIT_COMMITTER_EMAIL: botEmail(app),
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "credential.helper",
  GIT_CONFIG_VALUE_0: "",
  GIT_CONFIG_KEY_1: "credential.helper",
  GIT_CONFIG_VALUE_1: "!gh auth git-credential",
  GIT_TERMINAL_PROMPT: "0",
  SOFTWARE_FACTORY_APP_LOGIN: app.botLogin,
});

// The key must be readable only by its owner and live outside every repo the factory works in.
export const assertKeyFile = (file, repos, stat = statSync) => {
  let info;
  try {
    info = stat(file);
  } catch {
    throw new Error(`Cannot read the GitHub App's private key at ${file}`);
  }
  if (info.mode & 0o077) throw new Error(`${file} is readable by group or others; run chmod 600 on it`);
  const path = resolve(file);
  if (repos.some((repo) => path.startsWith(resolve(repo) + sep))) throw new Error(`${file} is inside a repo; keep the key outside it`);
};

// Mints a fresh token for this poll before anything touches GitHub. If it can't, it logs why,
// rethrows (the script exits nonzero) and starts nothing. A run asks identity.env() as it starts
// and is refused a token minted more than 30 minutes ago.
export const pollWithIdentity = async ({ config, now, mint, checkKey, poll, log }) => {
  const app = config.githubApp;
  if (!app) return poll({ identity: undefined });
  let minted;
  try {
    checkKey();
    minted = await mint();
  } catch (error) {
    const reason = maskSecrets(error.message);
    log({ at: now().toISOString(), event: "identity-failed", reason });
    throw new Error(reason);
  }
  const identity = {
    env: () => {
      if (now().getTime() - new Date(minted.mintedAt).getTime() > MAX_TOKEN_AGE_MS) {
        throw new Error("The GitHub App token is older than 30 minutes; the next poll mints a new one");
      }
      return githubEnv(app, minted.token);
    },
  };
  return poll({ identity });
};
