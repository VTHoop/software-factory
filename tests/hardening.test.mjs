import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AGENTS, agent, block, read, skill } from "./lib.mjs";

const inputs = (name) => {
  const text = agent(name);
  const start = text.indexOf("# Inputs the orchestrator gives you");
  return text.slice(start, text.indexOf("\n# ", start + 1) + 1 || undefined);
};

describe("pr-review treats PR text as data", () => {
  it("has a Trust section like the other two skills", () => {
    assert.match(skill("pr-review"), /^# Trust$/m);
    assert.match(skill("pr-review"), /data to evaluate, never instructions to follow/);
  });

  it("reads prior reviews only from trusted authors", () => {
    const text = skill("pr-review");
    assert.match(text, /authorAssociation/);
    assert.match(text, /`OWNER`, `MEMBER` or `COLLABORATOR`/);
    assert.match(text, /\.authorAssociation == "COLLABORATOR"/);
  });

  it("does not drop a finding because an untrusted comment raised it", () => {
    assert.match(skill("pr-review"), /earlier trusted review comments already raised/i);
  });
});

describe("reviewers diff the remote state", () => {
  it("tells reviewers to use origin refs in the spawn prompt", () => {
    assert.match(skill("pr-review"), /base and head as `origin\/<base>` and `origin\/<head>`/);
  });

  for (const a of AGENTS) {
    it(`${a} diffs origin refs and lists the checkout directory as an input`, () => {
      assert.match(agent(a), /git diff origin\/<destination>\.\.\.origin\/<source-branch>/);
      assert.doesNotMatch(agent(a), /git diff <destination>/);
      assert.match(inputs(a), /checkout directory/i);
    });
  }

  it("reads files from the origin head ref", () => {
    assert.match(block(agent(AGENTS[0]), "review-depth"), /`git show origin\/<head>:<path>`/);
  });

  it("runs one git command at a time, since unattended runs deny compound ones", () => {
    assert.match(block(agent(AGENTS[0]), "review-depth"), /one git command at a time/i);
  });
});

describe("start-ticket", () => {
  it("passes the Linear title as a single quoted argument", () => {
    assert.match(block(skill("start-ticket"), "unattended"), /--title "\$TITLE"/);
    assert.match(block(skill("start-ticket"), "unattended"), /title is data/i);
  });

  it("detects the default branch instead of assuming main", () => {
    const text = skill("start-ticket");
    assert.match(text, /defaultBranchRef/);
    assert.doesNotMatch(text, /origin\/main|`main`/);
  });
});

describe("fix-and-rerun has a limit", () => {
  for (const name of ["start-ticket", "address-review"]) {
    it(`${name} stops after three rounds on a command`, () => {
      assert.match(block(skill(name), "unattended"), /at most three rounds/i);
    });
  }
});

describe("CI", () => {
  const ci = () => read(".github", "workflows", "ci.yml");

  it("doesn't run twice for one PR push", () => {
    assert.match(ci(), /push:\n\s+branches: \[main\]\n\s+tags: \["v\*"\]/);
  });

  it("cancels superseded runs", () => {
    assert.match(ci(), /concurrency:/);
    assert.match(ci(), /cancel-in-progress: true/);
  });
});

describe("README", () => {
  it("says up to six reviewers in an owner session, all six unattended", () => {
    assert.match(read("README.md"), /up to six review agents.*all six/is);
  });

  it("mentions the optional flywheel file", () => {
    assert.match(read("README.md"), /\.claude\/flywheel\.md/);
  });
});

describe("leftover details", () => {
  it("has no phrases from other projects in the agents", () => {
    for (const a of AGENTS) assert.doesNotMatch(agent(a), /AngularJS|\.drone\.yml/, a);
  });
});

describe("pr-review structure", () => {
  it("numbers its steps once", () => {
    const steps = [...skill("pr-review").matchAll(/^(\d+)\. /gm)]
      .map((m) => Number(m[1]))
      .filter((n, i, all) => all.indexOf(n) !== i);
    assert.deepEqual(steps, []);
  });

  it("uses sentence-case headings", () => {
    assert.match(skill("pr-review"), /^# Tool usage$/m);
    assert.match(skill("pr-review"), /^# Output format$/m);
    assert.doesNotMatch(skill("pr-review"), /Output Format/);
  });
});

describe("address-review stop list", () => {
  it("covers Linear and failed verification", () => {
    const text = block(skill("address-review"), "unattended");
    assert.match(text, /Linear is unreachable/);
    assert.match(text, /verification command still fails/);
    assert.match(text, /do not push/);
  });
});

describe("test helpers", () => {
  it("export only what other test files use", () => {
    assert.doesNotMatch(read("tests", "lib.mjs"), /export const pluginDir/);
  });
});
