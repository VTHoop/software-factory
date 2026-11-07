import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildSettings } from "../../orchestrator/claude.mjs";
import { claudeEnv, gitEnv, githubConfigFor, reviewFiles, settingsFor, writeSettings } from "../../orchestrator/wiring.mjs";
import { tmp } from "./fakes.mjs";

const app = { appId: "1", installationId: "2", privateKeyFile: "/keys/app.pem", botLogin: "factory[bot]", botUserId: 4242 };
const config = { base: "main", trustedAuthors: ["VTHoop"], previewAuthors: ["vercel"], githubApp: app };
const entry = { repo: "/work/repo", githubRepo: "o/r", team: "T", extraDenials: ["Bash(x:*)"] };
const identity = { env: () => ({ GH_TOKEN: "run-token" }), callEnv: () => ({ GH_TOKEN: "call-token" }) };

describe("settingsFor", () => {
  it("denies reading the App's key file", () => {
    assert.ok(settingsFor(entry, config).permissions.deny.includes("Read(/keys/app.pem)"));
  });

  it("denies posting only for the review step", () => {
    assert.ok(settingsFor(entry, config, "review").permissions.deny.some((d) => d.startsWith("Bash(gh pr comment")));
    assert.ok(!settingsFor(entry, config).permissions.deny.some((d) => d.startsWith("Bash(gh pr comment")));
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

describe("writeSettings", () => {
  const denies = (file) => JSON.parse(readFileSync(file, "utf8")).permissions.deny;
  const posting = (file) => denies(file).some((d) => d.includes("gh pr comment"));

  it("hands the review step the settings that deny posting, and every other step the ones that don't", () => {
    const pathFor = writeSettings(tmp(), entry, config);
    assert.ok(posting(pathFor("review")));
    for (const step of ["implement", "answer", undefined]) assert.ok(!posting(pathFor(step)), String(step));
    assert.notEqual(pathFor("review"), pathFor("implement"));
  });
});

describe("reviewFiles", () => {
  const checkout = () => {
    const root = tmp();
    mkdirSync(join(root, ".software-factory"));
    return { root, file: join(root, ".software-factory", "review.md") };
  };

  it("reads the file, or null when there is none", () => {
    const { root, file } = checkout();
    assert.equal(reviewFiles.read(file, root), null);
    writeFileSync(file, "body");
    assert.equal(reviewFiles.read(file, root), "body");
  });

  it("removes the file, and does nothing when there is none", () => {
    const { root, file } = checkout();
    reviewFiles.remove(file, root);
    writeFileSync(file, "body");
    reviewFiles.remove(file, root);
    assert.ok(!existsSync(file));
  });

  it("removes a directory symlink without touching what it points at", () => {
    const root = tmp();
    const outside = tmp();
    writeFileSync(join(outside, "review.md"), "keep me");
    symlinkSync(outside, join(root, ".software-factory"));
    reviewFiles.remove(join(root, ".software-factory", "review.md"), root);
    assert.equal(readFileSync(join(outside, "review.md"), "utf8"), "keep me");
    assert.ok(!existsSync(join(root, ".software-factory")));
  });

  it("reads nothing through a symlink, whether the file or its directory is one", () => {
    const outside = tmp();
    writeFileSync(join(outside, "review.md"), "elsewhere");
    const a = checkout();
    symlinkSync(join(outside, "review.md"), a.file);
    assert.equal(reviewFiles.read(a.file, a.root), null);
    const root = tmp();
    symlinkSync(outside, join(root, ".software-factory"));
    assert.equal(reviewFiles.read(join(root, ".software-factory", "review.md"), root), null);
  });
});
