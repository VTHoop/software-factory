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
  const required = { model: "m", maxRunCostUsd: 1, runTimeoutMs: 1, entries: [{ repo: "/r", team: "T", githubRepo: "o/r" }] };
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
  it("sets a spend cap and no turn limit in the example, and says an old maxTurns is refused", () => {
    assert.ok(!section().includes('"maxTurns"'));
    assert.match(section(), /"maxRunCostUsd": \d/);
    assert.match(section(), /`maxTurns` is refused/);
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
  it("says the GitHub App must be installed on a new repo", () => {
    assert.match(section(), /installed on|install it on/i);
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

describe("orchestrator README and the GitHub App", () => {
  it("covers registering the App with only the permissions the factory needs", () => {
    assert.match(section(), /register.*GitHub App|GitHub App.*register/is);
    for (const word of ["contents", "pull requests", "issues", "checks"]) assert.match(section(), new RegExp(word, "i"), word);
  });
  it("covers installing it on a new repo and the rule that keeps it off main", () => {
    assert.match(section(), /install.*(repo|repositor)/is);
    assert.match(section(), /ruleset|rule on `?main/i);
  });
  it("documents githubApp, the key file's mode and where it lives", () => {
    assert.match(section(), /githubApp/);
    assert.match(section(), /privateKeyFile/);
    assert.match(section(), /600/);
    assert.match(section(), /outside the repo/i);
  });
  it("says a token is minted every poll and a failure to mint exits nonzero", () => {
    assert.match(section(), /every poll/i);
    assert.match(section(), /30 minutes/);
  });
  it("no longer asks for a collaborator account on a new repo", () => {
    assert.doesNotMatch(section(), /account that runs the script must be a collaborator/i);
  });
});

describe("orchestrator README is honest about the key", () => {
  it("calls the deny rules guardrails in the GitHub App section, and says what isolates the key", () => {
    const app = section().slice(section().indexOf("## The GitHub App"), section().indexOf("## Follow a run"));
    assert.match(app, /guardrail/i);
    assert.doesNotMatch(app, /run settings deny reading it/i);
    assert.match(app, /separate (macOS )?user/i);
  });
});

describe("orchestrator README and the needs-owner label", () => {
  it("says each Linear workspace needs a needs-owner label before the first run", () => {
    assert.match(section(), /`needs-owner`/);
    assert.match(section(), /label.*(each|every).*(workspace|team)|(each|every).*(workspace|team).*label/is);
  });
  it("says what an escalation that fails leaves behind and how to retry", () => {
    assert.match(section(), /escalation (itself )?fails/i);
    assert.match(section(), /next poll/i);
  });
});
