import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

// What the factory needs and nothing more: no admin, no workflows.
export const PERMISSIONS = { contents: "write", pull_requests: "write", issues: "write", checks: "read" };

const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

// The App's own short-lived credential, used only to ask for an installation token.
export const appJwt = ({ appId, privateKey, now }) => {
  const iat = Math.floor(now.getTime() / 1000) - 60;
  const body = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat, exp: iat + 540, iss: String(appId) })}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(privateKey).toString("base64url")}`;
};

// An installation token for only the configured repos. Errors name the cause, never the key or a token.
export const mintInstallationToken = async ({ app, repos, now, fetch = globalThis.fetch, readKey = readFileSync }) => {
  let privateKey;
  try {
    privateKey = readKey(app.privateKeyFile, "utf8");
  } catch {
    throw new Error(`Cannot read the GitHub App's private key at ${app.privateKeyFile}`);
  }
  let response;
  try {
    response = await fetch(`https://api.github.com/app/installations/${app.installationId}/access_tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt({ appId: app.appId, privateKey, now })}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ repositories: repos.map((r) => r.split("/").pop()), permissions: PERMISSIONS }),
    });
  } catch (error) {
    throw new Error(`GitHub App token request failed: ${error.message}`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GitHub App token request failed: HTTP ${response.status} ${body.message ?? ""}`.trim());
  return { token: body.token, mintedAt: now.toISOString() };
};
