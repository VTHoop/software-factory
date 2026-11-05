import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../orchestrator/config.mjs";
import { read } from "../lib.mjs";
import { tmp } from "./fakes.mjs";

// Every setting loadConfig knows, taken from the code rather than from a list here.
const settings = () => {
  const file = join(tmp("sf-readme-"), "config.json");
  const required = { model: "m", maxTurns: 1, runTimeoutMs: 1, entries: [{ repo: "/r", team: "T", githubRepo: "o/r" }] };
  writeFileSync(file, JSON.stringify(required));
  return Object.keys(loadConfig(file));
};

const section = () => {
  const text = read("orchestrator", "README.md");
  assert.ok(text.length > 0, "orchestrator/README.md is missing");
  return text;
};

describe("orchestrator README", () => {
  it("explains how to add a project", () => assert.match(section(), /add a project/i));
  it("explains how to follow a run", () => assert.match(section(), /follow a run/i));
  it("explains how to open a run with claude --resume", () => assert.match(section(), /claude --resume/));
  it("explains how to pause", () => assert.match(section(), /pause/i));
  it("says to stop the project's local services, such as Supabase, first", () => {
    assert.match(section(), /supabase stop|stop .*local services/i);
    assert.match(section(), /Supabase/);
  });
  it("names the secrets file outside the repo", () => {
    assert.match(section(), /~\/\.config\/software-factory\/secrets\.env/);
  });
  it("documents every setting loadConfig knows", () => {
    for (const name of settings()) assert.ok(section().includes(name), `missing ${name}`);
  });
  it("documents SOFTWARE_FACTORY_CONFIG and how the script exits", () => {
    for (const word of ["SOFTWARE_FACTORY_CONFIG", "exit code"]) assert.ok(section().includes(word), `missing ${word}`);
  });
  it("says which Node version it needs", () => {
    assert.match(section(), /Node(\.js)? 24/);
    assert.match(read("README.md"), /Node(\.js)? 24/);
  });
  it("lists the files in the state directory, including the per-repo settings files", () => {
    for (const word of ["state.json", "runs.jsonl", "settings-"]) assert.ok(section().includes(word), `missing ${word}`);
  });
  it("says a timed-out run writes no log line", () => {
    assert.match(section(), /timed-out run.*no (log )?line|no (log )?line.*timed-out run/is);
  });
  it("names what the handoff reads from address-review's reply", () => {
    assert.match(section(), /Dismissed/);
    assert.match(section(), /Deferred/);
    assert.match(section(), /column/i);
  });
  it("says the deny rules are guardrails and base-branch protection is needed", () => {
    assert.match(section(), /guardrail/i);
    assert.match(section(), /branch protection/i);
  });
  it("documents the per-repo needsDocker setting", () => assert.match(section(), /needsDocker/));
  it("says the agent's GitHub account must be a collaborator on a new repo", () => {
    assert.match(section(), /collaborator/i);
  });
  it("explains how to follow a live run from another machine", () => {
    assert.match(section(), /follow a live run/i);
    assert.match(section(), /ssh /);
    assert.match(section(), /tail -f/);
  });
  it("says the log records the Claude Code version", () => assert.match(section(), /claudeVersion/));
  describe("adopting a second project", () => {
    const adding = () => {
      const text = section();
      const start = text.search(/^## Add a project/m);
      assert.ok(start >= 0, "missing the Add a project section");
      const rest = text.slice(start + 1);
      const next = rest.search(/^## /m);
      return next < 0 ? rest : rest.slice(0, next);
    };
    it("lists the steps in order, starting with the Ready status on the team", () => {
      assert.match(adding(), /^1\. .*Ready/m);
    });
    it("says the adoption PR with Verification, .mcp.json and plugin settings merges before the first poll", () => {
      for (const word of ["## Verification", ".mcp.json", "enabledPlugins", "merged"]) {
        assert.ok(adding().includes(word), `missing ${word}`);
      }
    });
    it("says the project's own Linear workspace needs its own key, set in the environment that starts the script", () => {
      assert.match(adding(), /another Linear workspace|different Linear workspace/i);
      assert.match(adding(), /LINEAR_\w+_API_KEY/);
    });
    it("says to clone the repo for the agent user, install its dependencies and check gh is signed in as the agent", () => {
      assert.match(adding(), /clone/i);
      assert.match(adding(), /pnpm install|install its dependencies/i);
      assert.match(adding(), /gh auth status/);
    });
    it("says the team name must match Linear exactly and repo must be the agent's own clone", () => {
      assert.match(adding(), /exactly/i);
      assert.match(adding(), /own clone|agent's clone|the clone/i);
    });
    it("says the poll reads .mcp.json from the clone, so the clone must be pulled after .mcp.json changes", () => {
      assert.match(adding(), /git pull --ff-only|pull/);
      assert.match(adding(), /clone.*\.mcp\.json|\.mcp\.json.*clone/is);
    });
    it("says what to check when a Ready ticket is not picked up", () => {
      assert.match(adding(), /poll\.err\.log|not picked up/i);
    });
    it("says a public repo needs branch protection and that fork PRs and strangers' comments start nothing", () => {
      assert.match(adding(), /public repo/i);
      assert.match(adding(), /fork/i);
    });
  });
  it("is linked from the main README", () => {
    assert.match(read("README.md"), /orchestrator\/README\.md/);
  });
});
