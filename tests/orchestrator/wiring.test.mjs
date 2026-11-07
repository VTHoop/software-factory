import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSettings } from "../../orchestrator/claude.mjs";
import { claudeEnv, gitEnv, githubConfigFor, settingsFor } from "../../orchestrator/wiring.mjs";

const app = { appId: "1", installationId: "2", privateKeyFile: "/keys/app.pem", botLogin: "factory[bot]", botUserId: 4242 };
const config = { base: "main", trustedAuthors: ["VTHoop"], previewAuthors: ["vercel"], githubApp: app };
const entry = { repo: "/work/repo", githubRepo: "o/r", team: "T", extraDenials: ["Bash(x:*)"] };
const identity = { env: () => ({ GH_TOKEN: "run-token" }), callEnv: () => ({ GH_TOKEN: "call-token" }) };

describe("settingsFor", () => {
  it("denies reading the App's key file", () => {
    assert.ok(settingsFor(entry, config).permissions.deny.includes("Read(/keys/app.pem)"));
  });

  it("is the same as before when no App is configured", () => {
    const plain = { ...config, githubApp: undefined };
    assert.deepEqual(settingsFor(entry, plain), buildSettings(entry, { base: "main" }));
  });
});

describe("githubConfigFor", () => {
  it("names the App's login and the repo's trusted authors", () => {
    const github = githubConfigFor(entry, config, identity);
    assert.equal(github.appLogin, "factory[bot]");
    assert.equal(github.githubRepo, "o/r");
    assert.deepEqual(github.trustedAuthors, ["VTHoop"]);
  });

  it("asks for the environment again on every gh call, so the token's age is checked each time", () => {
    let calls = 0;
    const github = githubConfigFor(entry, config, { ...identity, callEnv: () => ({ GH_TOKEN: `t${++calls}` }) });
    assert.equal(typeof github.env, "function");
    assert.equal(github.env().GH_TOKEN, "t1");
    assert.equal(github.env().GH_TOKEN, "t2");
  });

  it("keeps PATH and the rest of the environment beside the token", () => {
    const env = githubConfigFor(entry, config, identity).env();
    assert.equal(env.PATH, process.env.PATH);
  });

  it("has no env when no App is configured", () => {
    assert.equal(githubConfigFor(entry, { ...config, githubApp: undefined }, undefined).env, undefined);
  });
});

describe("claudeEnv", () => {
  it("gives a run the token its identity allows at the start of a run, and PATH", () => {
    const env = claudeEnv(identity);
    assert.equal(env.GH_TOKEN, "run-token");
    assert.equal(env.PATH, process.env.PATH);
  });

  it("changes nothing without an App", () => {
    assert.equal(claudeEnv(undefined).GH_TOKEN, process.env.GH_TOKEN);
  });
});

describe("gitEnv", () => {
  it("gives the script's own git calls the token, without touching process.env", () => {
    const before = process.env.GH_TOKEN;
    assert.equal(gitEnv(identity).GH_TOKEN, "call-token");
    assert.equal(process.env.GH_TOKEN, before);
  });

  it("is undefined without an App, so git inherits the environment", () => {
    assert.equal(gitEnv(undefined), undefined);
  });
});
