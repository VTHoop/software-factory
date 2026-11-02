import { readFileSync } from "node:fs";

const PUSHOVER = "https://api.pushover.net/1/messages.json";
const MAX_MESSAGE = 1024;

export const loadSecrets = (file) =>
  Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .map((line) => line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.replace(/^(["'])(.*)\1$/, "$2")]),
  );

// Handoffs, escalations and pauses all go out through here.
export const notify = async ({ title, message, url }, { secrets, fetch = globalThis.fetch }) => {
  const body = new URLSearchParams({
    token: secrets.PUSHOVER_APP_TOKEN,
    user: secrets.PUSHOVER_USER_KEY,
    title,
    message: message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE - 1)}…` : message,
  });
  if (url) body.set("url", url);
  const response = await fetch(PUSHOVER, { method: "POST", body });
  if (!response.ok) throw new Error(`Pushover returned HTTP ${response.status}`);
};
