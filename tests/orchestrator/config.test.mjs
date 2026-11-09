import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { defaultPaths, entryFor, linearKeyFor, loadConfig } from "../../orchestrator/config.mjs";
import { root } from "../lib.mjs";
import { tmp as scratch } from "./fakes.mjs";

const tmp = () => scratch("sf-config-");

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
  const base = { model: "sonnet", maxRunCostUsd: 4, runTimeoutMs: 1800000, trustedAuthors: ["VTHoop"], entries: [entry] };

  it("takes maxRunCostUsd only as a number above zero", () => {
    for (const bad of [0, "", -1, "3", Number.NaN, null]) {
      assert.throws(() => loadConfig(write({ ...base, maxRunCostUsd: bad })), /maxRunCostUsd/, String(bad));
    }
    assert.equal(loadConfig(write({ ...base, maxRunCostUsd: 2.5 })).maxRunCostUsd, 2.5);
  });

  it("refuses the old maxTurns, so an owner doesn't think it still limits a run", () => {
    assert.throws(() => loadConfig(write({ ...base, maxTurns: 80 })), /maxTurns.*maxRunCostUsd/);
  });

  it("holds the model in one value", () => {
    assert.equal(loadConfig(write(base)).model, "sonnet");
  });

  it("requires a model, a time limit and a spend cap", () => {
    for (const k of ["model", "runTimeoutMs", "maxRunCostUsd"]) {
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

describe("loadConfig defaults", () => {
  const write = (extra = {}) => {
    const dir = tmp();
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        model: "sonnet",
        maxRunCostUsd: 4,
        runTimeoutMs: 1000,
        entries: [{ repo: "/r", team: "T", githubRepo: "o/r" }],
        ...extra,
      }),
    );
    return file;
  };

  it("fills in the base branch, CI timing, preview authors and trusted authors", () => {
    const config = loadConfig(write());
    assert.equal(config.base, "main");
    assert.equal(config.ciTimeoutMs, 900_000);
    assert.equal(config.ciIntervalMs, 30_000);
    assert.deepEqual(config.previewAuthors, ["vercel"]);
    assert.deepEqual(config.trustedAuthors, []);
  });

  it("keeps a value the file sets", () => {
    assert.equal(loadConfig(write({ base: "develop" })).base, "develop");
  });
});

describe("loadConfig githubApp", () => {
  const write = (config) => {
    const file = join(tmp(), "config.json");
    writeFileSync(file, JSON.stringify(config));
    return file;
  };
  const githubApp = { appId: "1", installationId: "2", privateKeyFile: "/keys/app.pem", botLogin: "factory[bot]", botUserId: 4242 };
  const base = { model: "sonnet", maxRunCostUsd: 4, runTimeoutMs: 1800000, entries: [{ repo: "/r", team: "T", githubRepo: "o/r" }] };

  it("is optional", () => {
    assert.equal(loadConfig(write(base)).githubApp, undefined);
  });

  it("keeps a complete App", () => {
    assert.deepEqual(loadConfig(write({ ...base, githubApp })).githubApp, githubApp);
  });

  it("names the missing field", () => {
    for (const k of Object.keys(githubApp)) {
      const { [k]: _, ...rest } = githubApp;
      assert.throws(() => loadConfig(write({ ...base, githubApp: rest })), new RegExp(`githubApp.${k}`));
    }
  });

  it("requires the bot login to end in [bot]", () => {
    assert.throws(() => loadConfig(write({ ...base, githubApp: { ...githubApp, botLogin: "factory" } })), /\[bot\]/);
  });
});

describe("loadConfig githubApp and the run limit", () => {
  const githubApp = { appId: "1", installationId: "2", privateKeyFile: "/keys/app.pem", botLogin: "factory[bot]", botUserId: 4242 };
  const base = { model: "sonnet", maxRunCostUsd: 4, entries: [{ repo: "/r", team: "T", githubRepo: "o/r" }], githubApp };
  const write = (config) => {
    const file = join(tmp(), "config.json");
    writeFileSync(file, JSON.stringify(config));
    return file;
  };

  it("accepts a run limit up to 30 minutes", () => {
    assert.doesNotThrow(() => loadConfig(write({ ...base, runTimeoutMs: 1_800_000 })));
  });

  it("refuses a longer run limit, which a token could not outlive", () => {
    assert.throws(() => loadConfig(write({ ...base, runTimeoutMs: 1_800_001 })), /runTimeoutMs.*30 minutes/);
  });

  it("does not limit the run when no App is configured", () => {
    const { githubApp: _, ...plain } = base;
    assert.doesNotThrow(() => loadConfig(write({ ...plain, runTimeoutMs: 7_200_000 })));
  });
});
