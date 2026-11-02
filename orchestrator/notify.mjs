import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const PUSHOVER = "https://api.pushover.net/1/messages.json";
const MAX_MESSAGE = 1024;
const TIMEOUT_MS = 15_000;

export const loadSecrets = (file) => parseEnv(readFileSync(file, "utf8"));

// Handoffs, escalations and pauses all go out through here.
export const notify = async ({ title, message, url }, { secrets, fetch = globalThis.fetch }) => {
  const body = new URLSearchParams({
    token: secrets.PUSHOVER_APP_TOKEN,
    user: secrets.PUSHOVER_USER_KEY,
    title,
    message: message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE - 1)}…` : message,
  });
  if (url) body.set("url", url);
  const response = await fetch(PUSHOVER, { method: "POST", body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Pushover returned HTTP ${response.status}`);
};
