import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadSecrets, notify } from "../../orchestrator/notify.mjs";
import { tmp } from "./fakes.mjs";

const secrets = { PUSHOVER_USER_KEY: "u-key", PUSHOVER_APP_TOKEN: "a-token" };

describe("notify", () => {
  it("posts to Pushover with the title, message and link", async () => {
    const sent = [];
    const fetch = async (url, init) => (sent.push({ url, body: new URLSearchParams(init.body) }), { ok: true });
    await notify({ kind: "escalation", title: "HEA-1 escalated", message: "why", url: "https://x/pr/7" }, { secrets, fetch });
    assert.equal(sent.length, 1);
    assert.match(sent[0].url, /api\.pushover\.net/);
    assert.equal(sent[0].body.get("title"), "HEA-1 escalated");
    assert.equal(sent[0].body.get("message"), "why");
    assert.equal(sent[0].body.get("url"), "https://x/pr/7");
  });

  for (const kind of ["handoff", "escalation", "pause"]) {
    it(`sends a ${kind} through the same channel`, async () => {
      const urls = [];
      const fetch = async (url) => (urls.push(url), { ok: true });
      await notify({ kind, title: "t", message: "m" }, { secrets, fetch });
      assert.equal(urls.length, 1);
      assert.match(urls[0], /pushover/);
    });
  }

  it("does not put its credentials in the error when the send fails", async () => {
    const fetch = async () => ({ ok: false, status: 400 });
    await assert.rejects(notify({ kind: "pause", title: "t", message: "m" }, { secrets, fetch }), (e) => {
      assert.ok(!e.message.includes("u-key") && !e.message.includes("a-token"));
      return true;
    });
  });

  it("puts a time limit on the request", async () => {
    let signal;
    const fetch = async (url, init) => ((signal = init.signal), { ok: true });
    await notify({ kind: "pause", title: "t", message: "m" }, { secrets, fetch });
    assert.ok(signal instanceof AbortSignal);
  });
});

describe("notify guards", () => {
  it("cuts a long message to the Pushover limit", async () => {
    let body;
    const fetch = async (url, init) => ((body = new URLSearchParams(init.body)), { ok: true });
    await notify({ kind: "pause", title: "t", message: "x".repeat(5000) }, { secrets, fetch });
    assert.ok(body.get("message").length <= 1024);
  });

  it("says which secret is missing instead of sending the word undefined", async () => {
    const fetch = async () => assert.fail("sent");
    await assert.rejects(notify({ kind: "pause", title: "t", message: "m" }, { secrets: {}, fetch }), /PUSHOVER_APP_TOKEN/);
  });
});

describe("loadSecrets", () => {
  it("reads NAME=value lines, with comments, export and quotes", () => {
    const file = join(tmp("sf-secrets-"), "secrets.env");
    const [user, app] = ["PUSHOVER_USER_KEY", "PUSHOVER_APP_TOKEN"];
    writeFileSync(file, `# comment\nexport ${user}="u-key"\n${app}=a-token # note\n`);
    assert.deepEqual(loadSecrets(file), { PUSHOVER_USER_KEY: "u-key", PUSHOVER_APP_TOKEN: "a-token" });
  });
});
