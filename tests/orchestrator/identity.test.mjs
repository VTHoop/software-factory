import assert from "node:assert/strict";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { assertKeyFile, botEmail, githubEnv, MAX_TOKEN_AGE_MS, pollWithIdentity } from "../../orchestrator/identity.mjs";
import { tmp } from "./fakes.mjs";

const app = { appId: "1", installationId: "2", privateKeyFile: "/keys/app.pem", botLogin: "factory[bot]", botUserId: 4242 };
const config = { githubApp: app, entries: [{ repo: "/work/repo", githubRepo: "o/r", team: "T" }] };
const t0 = new Date("2026-11-05T20:00:00Z");
const LEAK = `ghs_${"b".repeat(30)}`;
const minutes = (n) => new Date(t0.getTime() + n * 60_000);
const minted = (at = t0) => ({ token: "ghs_secret_token", mintedAt: at.toISOString() });

describe("githubEnv", () => {
  const env = githubEnv(app, "ghs_secret_token");

  it("gives gh the token", () => {
    assert.equal(env.GH_TOKEN, "ghs_secret_token");
  });

  it("makes commits show as the App, with its noreply email", () => {
    assert.equal(botEmail(app), "4242+factory[bot]@users.noreply.github.com");
    assert.equal(env.GIT_AUTHOR_NAME, "factory[bot]");
    assert.equal(env.GIT_AUTHOR_EMAIL, "4242+factory[bot]@users.noreply.github.com");
    assert.equal(env.GIT_COMMITTER_NAME, env.GIT_AUTHOR_NAME);
    assert.equal(env.GIT_COMMITTER_EMAIL, env.GIT_AUTHOR_EMAIL);
  });

  it("gives git the token through gh's credential helper, never in a URL or git setting", () => {
    const values = Object.entries(env).filter(([k]) => k !== "GH_TOKEN").map(([, v]) => String(v));
    assert.ok(values.every((v) => !v.includes("ghs_secret_token")));
    assert.ok(values.some((v) => v === "!gh auth git-credential"));
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  });

  it("tells the skills which login is the App", () => {
    assert.equal(env.SOFTWARE_FACTORY_APP_LOGIN, "factory[bot]");
  });
});

describe("assertKeyFile", () => {
  const dir = tmp("sf-key-");
  const key = (mode, name = "app.pem") => {
    const file = join(dir, name);
    writeFileSync(file, "pem");
    chmodSync(file, mode);
    return file;
  };

  it("accepts a key only the owner can read, outside every repo", () => {
    assert.doesNotThrow(() => assertKeyFile(key(0o600), ["/work/repo"]));
  });

  it("refuses a key that group or others can read", () => {
    assert.throws(() => assertKeyFile(key(0o640, "g.pem"), []), /readable/);
    assert.throws(() => assertKeyFile(key(0o604, "o.pem"), []), /readable/);
  });

  it("refuses a key inside a configured repo", () => {
    const repo = join(dir, "repo");
    mkdirSync(repo);
    const file = join(repo, "app.pem");
    writeFileSync(file, "pem");
    chmodSync(file, 0o600);
    assert.throws(() => assertKeyFile(file, [repo]), /inside/);
  });

  it("names the file but not its contents when it is missing", () => {
    assert.throws(() => assertKeyFile(join(dir, "missing.pem"), []), /missing\.pem/);
  });
});

describe("pollWithIdentity", () => {
  const harness = (over = {}) => {
    const calls = [];
    const logs = [];
    return {
      calls,
      logs,
      args: {
        config,
        now: () => t0,
        mint: async () => { calls.push("mint"); return minted(); },
        checkKey: () => calls.push("checkKey"),
        poll: async ({ identity }) => { calls.push("poll"); return { acted: true, identity }; },
        log: (r) => logs.push(r),
        ...over,
      },
    };
  };

  it("mints a new token for every poll", async () => {
    const h = harness();
    await pollWithIdentity(h.args);
    await pollWithIdentity(h.args);
    assert.deepEqual(h.calls.filter((c) => c === "mint"), ["mint", "mint"]);
  });

  it("mints and checks the key before anything else happens", async () => {
    const h = harness();
    await pollWithIdentity(h.args);
    assert.deepEqual(h.calls, ["checkKey", "mint", "poll"]);
  });

  it("gives a run the token's environment while it is under 30 minutes old", async () => {
    let at = t0;
    const h = harness({ now: () => at });
    let identity;
    h.args.poll = async (p) => { identity = p.identity; };
    await pollWithIdentity(h.args);
    at = minutes(29);
    assert.equal(identity.env().GH_TOKEN, "ghs_secret_token");
  });

  it("refuses a run on a token older than 30 minutes", async () => {
    assert.equal(MAX_TOKEN_AGE_MS, 30 * 60_000);
    let at = t0;
    const h = harness({ now: () => at });
    let identity;
    h.args.poll = async (p) => { identity = p.identity; };
    await pollWithIdentity(h.args);
    at = minutes(31);
    assert.throws(() => identity.env(), /older than 30 minutes/);
  });

  it("logs why, rethrows and starts nothing when a token cannot be minted", async () => {
    const h = harness({ mint: async () => { throw new Error("GitHub App token request failed: HTTP 401 Bad credentials"); } });
    await assert.rejects(pollWithIdentity(h.args), /401/);
    assert.ok(!h.calls.includes("poll"));
    assert.equal(h.logs.length, 1);
    assert.match(h.logs[0].reason, /401 Bad credentials/);
    assert.equal(h.logs[0].event, "identity-failed");
  });

  it("starts nothing when the key file is unsafe", async () => {
    const h = harness({ checkKey: () => { throw new Error("key is readable by others"); } });
    await assert.rejects(pollWithIdentity(h.args), /readable/);
    assert.ok(!h.calls.includes("poll"));
    assert.match(h.logs[0].reason, /readable/);
  });

  it("never logs a token or key", async () => {
    const h = harness({ mint: async () => { throw new Error(`bad ${LEAK} and -----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----`); } });
    await assert.rejects(pollWithIdentity(h.args));
    assert.ok(!JSON.stringify(h.logs).includes(LEAK));
    assert.ok(!JSON.stringify(h.logs).includes("BEGIN PRIVATE KEY"));
  });

  it("runs a config with no GitHub App as before, minting nothing", async () => {
    const h = harness({ config: { entries: [] } });
    await pollWithIdentity(h.args);
    assert.deepEqual(h.calls, ["poll"]);
  });
});
