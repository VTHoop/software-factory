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
  it("is linked from the main README", () => {
    assert.match(read("README.md"), /orchestrator\/README\.md/);
  });
});
