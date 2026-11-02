import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { defaultPaths, linearKeyFor, loadConfig, projectFor } from "../../orchestrator/config.mjs";
import { root } from "../lib.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "sf-config-"));

const repoWithMcp = (envName) => {
  const repo = tmp();
  writeFileSync(
    join(repo, ".mcp.json"),
    JSON.stringify({
      mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp", headers: { Authorization: `Bearer \${${envName}}` } } },
    }),
  );
  return repo;
};

describe("linearKeyFor", () => {
  it("reads the key from the environment variable the repo's .mcp.json names", () => {
    const repo = repoWithMcp("LINEAR_HEA_API_KEY");
    assert.equal(linearKeyFor(repo, { LINEAR_HEA_API_KEY: "lin_test" }), "lin_test");
  });

  it("uses a different key for a repo that names a different variable", () => {
    const repo = repoWithMcp("LINEAR_OTHER_API_KEY");
    assert.equal(linearKeyFor(repo, { LINEAR_HEA_API_KEY: "a", LINEAR_OTHER_API_KEY: "b" }), "b");
  });

  it("says which variable is missing", () => {
    const repo = repoWithMcp("LINEAR_HEA_API_KEY");
    assert.throws(() => linearKeyFor(repo, {}), /LINEAR_HEA_API_KEY/);
  });
});

describe("loadConfig", () => {
  const write = (config) => {
    const file = join(tmp(), "config.json");
    writeFileSync(file, JSON.stringify(config));
    return file;
  };
  const entry = { repo: "/work/sidekick", githubRepo: "VTHoop/disciplined-sidekick", projects: ["Health Agent"] };
  const base = { model: "sonnet", maxTurns: 80, runTimeoutMs: 1800000, trustedAuthors: ["VTHoop"], entries: [entry] };

  it("holds the model in one value", () => {
    assert.equal(loadConfig(write(base)).model, "sonnet");
  });

  it("requires a model, a time limit and a turn limit", () => {
    for (const k of ["model", "maxTurns", "runTimeoutMs"]) {
      const { [k]: _, ...rest } = base;
      assert.throws(() => loadConfig(write(rest)), new RegExp(k));
    }
  });

  it("requires each entry to name a repo and at least one project", () => {
    assert.throws(() => loadConfig(write({ ...base, entries: [{ repo: "/x", projects: [] }] })), /projects/);
    assert.throws(() => loadConfig(write({ ...base, entries: [{ projects: ["P"] }] })), /repo/);
  });

  it("finds the entry for a Linear project", () => {
    assert.equal(projectFor(loadConfig(write(base)), "Health Agent").repo, "/work/sidekick");
    assert.equal(projectFor(loadConfig(write(base)), "Other"), null);
  });
});

describe("defaultPaths", () => {
  it("keeps config, secrets, state and logs outside the repo", () => {
    const paths = defaultPaths({ HOME: "/home/someone" });
    for (const p of Object.values(paths)) {
      assert.ok(!p.startsWith(root), `${p} is inside the repo`);
    }
    assert.match(paths.secrets, /\.config\/software-factory\/secrets\.env$/);
  });
});
