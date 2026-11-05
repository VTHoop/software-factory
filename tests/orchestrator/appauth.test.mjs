import assert from "node:assert/strict";
import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import { appJwt, mintInstallationToken, PERMISSIONS } from "../../orchestrator/appauth.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const app = { appId: "12345", installationId: "999", privateKeyFile: "/keys/app.pem", botLogin: "factory[bot]", botUserId: 4242 };
const now = new Date("2026-11-05T20:00:00Z");

const fakeFetch = (reply = { status: 201, body: { token: "ghs_installation", expires_at: "2026-11-05T21:00:00Z" } }) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    return { ok: reply.status < 300, status: reply.status, json: async () => reply.body, text: async () => JSON.stringify(reply.body) };
  };
  return { fetch, calls };
};

describe("appJwt", () => {
  const jwt = appJwt({ appId: "12345", privateKey: pem, now });
  const [header, payload, signature] = jwt.split(".");
  const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString());

  it("is an RS256 token issued by the App id, valid for under ten minutes", () => {
    assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT" });
    const claims = decode(payload);
    assert.equal(claims.iss, "12345");
    assert.ok(claims.exp - claims.iat <= 600);
    assert.ok(claims.iat <= Math.floor(now / 1000));
  });

  it("is signed with the App's private key", () => {
    const ok = createVerify("RSA-SHA256").update(`${header}.${payload}`).verify(createPublicKey(publicKey), Buffer.from(signature, "base64url"));
    assert.ok(ok);
  });
});

describe("mintInstallationToken", () => {
  const mint = (fetch, repos = ["VTHoop/sandlot-game"]) =>
    mintInstallationToken({ app, repos, now, fetch, readKey: () => pem });

  it("asks only for the configured repos and the factory's permissions", async () => {
    const { fetch, calls } = fakeFetch();
    await mint(fetch, ["VTHoop/sandlot-game", "VTHoop/disciplined-sidekick"]);
    assert.equal(calls[0].url, "https://api.github.com/app/installations/999/access_tokens");
    assert.deepEqual(calls[0].body.repositories, ["sandlot-game", "disciplined-sidekick"]);
    assert.deepEqual(calls[0].body.permissions, PERMISSIONS);
  });

  it("asks for contents, pull requests and issues write and checks read, with no admin or workflows", () => {
    assert.deepEqual(PERMISSIONS, { contents: "write", pull_requests: "write", issues: "write", checks: "read" });
  });

  it("authenticates as the App with a JWT, not with the token it is asking for", async () => {
    const { fetch, calls } = fakeFetch();
    await mint(fetch);
    assert.match(calls[0].init.headers.Authorization, /^Bearer eyJ/);
  });

  it("returns the token with the time it was minted", async () => {
    const { fetch } = fakeFetch();
    const result = await mint(fetch);
    assert.equal(result.token, "ghs_installation");
    assert.equal(result.mintedAt, now.toISOString());
  });

  it("says why a mint failed without printing the key or a token", async () => {
    const { fetch } = fakeFetch({ status: 401, body: { message: "Bad credentials" } });
    await assert.rejects(mint(fetch), (error) => {
      assert.match(error.message, /401/);
      assert.match(error.message, /Bad credentials/);
      assert.ok(!error.message.includes("PRIVATE KEY"));
      assert.ok(!/eyJ/.test(error.message));
      return true;
    });
  });

  it("fails when the key file cannot be read, naming the file but not its contents", async () => {
    const { fetch } = fakeFetch();
    await assert.rejects(
      mintInstallationToken({ app, repos: ["o/r"], now, fetch, readKey: () => { throw new Error("ENOENT"); } }),
      /\/keys\/app\.pem/,
    );
  });
});
