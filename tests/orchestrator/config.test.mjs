import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { defaultPaths, entryFor, linearKeyFor, loadConfig } from "../../orchestrator/config.mjs";
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
  const entry = { repo: "/work/sidekick", githubRepo: "VTHoop/disciplined-sidekick", team: "Health Agent" };
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

  it("requires each entry to name a repo and a team, and no project", () => {
    assert.throws(() => loadConfig(write({ ...base, entries: [{ team: "T" }] })), /repo/);
    assert.throws(() => loadConfig(write({ ...base, entries: [{ repo: "/x" }] })), /team/);
    assert.equal(loadConfig(write(base)).entries[0].projects, undefined);
  });

  it("requires each entry's GitHub repo, which every PR is checked against", () => {
    assert.throws(() => loadConfig(write({ ...base, entries: [{ repo: "/x", team: "T" }] })), /githubRepo/);
  });

  it("rejects an empty projects list, which would match nothing", () => {
    assert.throws(() => loadConfig(write({ ...base, entries: [{ ...entry, projects: [] }] })), /projects/);
  });

  it("accepts an empty entries list, which stops new work", () => {
    assert.deepEqual(loadConfig(write({ ...base, entries: [] })).entries, []);
  });

  it("rejects two entries for one team unless each names projects", () => {
    const other = { ...entry, repo: "/work/other" };
    assert.throws(() => loadConfig(write({ ...base, entries: [entry, other] })), /team/);
    const split = [
      { ...entry, projects: ["A"] },
      { ...other, projects: ["B"] },
    ];
    assert.equal(loadConfig(write({ ...base, entries: split })).entries.length, 2);
  });
});

describe("entryFor", () => {
  const teamWide = { repo: "/a", team: "T" };
  const narrow = { repo: "/b", team: "T", projects: ["P"] };

  it("finds the entry for a team", () => {
    assert.equal(entryFor({ entries: [teamWide] }, { team: "T", project: "Any" }), teamWide);
    assert.equal(entryFor({ entries: [teamWide] }, { team: "Other" }), null);
  });

  it("prefers an entry that lists the issue's project over the team-wide one", () => {
    const config = { entries: [teamWide, narrow] };
    assert.equal(entryFor(config, { team: "T", project: "P" }), narrow);
    assert.equal(entryFor(config, { team: "T", project: "Q" }), teamWide);
  });

  it("does not match an entry that lists projects when the issue has none", () => {
    assert.equal(entryFor({ entries: [narrow] }, { team: "T", project: null }), null);
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
