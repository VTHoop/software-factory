import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { AGENTS, agent, exists, json, listDir, read, root, SKILLS } from "./lib.mjs";

const hasClaude = spawnSync("claude", ["--version"]).status === 0;

describe("marketplace and plugin", () => {
  it("names the marketplace software-factory and lists the plugin from a subdirectory", () => {
    const market = json(".claude-plugin", "marketplace.json");
    assert.equal(market.name, "software-factory");
    assert.equal(market.plugins.length, 1);
    assert.equal(market.plugins[0].name, "software-factory");
    assert.equal(market.plugins[0].source, "./plugins/software-factory");
  });

  it("names the plugin software-factory with a semver version", () => {
    const plugin = json("plugins", "software-factory", ".claude-plugin", "plugin.json");
    assert.equal(plugin.name, "software-factory");
    assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  });

  it("passes claude plugin validate", { skip: !hasClaude && "claude not on PATH" }, () => {
    for (const target of [".", "plugins/software-factory"]) {
      execFileSync("claude", ["plugin", "validate", target], { cwd: root, stdio: "pipe" });
    }
  });
});

describe("contents", () => {
  it("holds exactly the three skills", () => {
    assert.deepEqual(listDir("plugins", "software-factory", "skills"), SKILLS);
  });

  it("holds exactly the six review agents, each named after its file", () => {
    assert.deepEqual(
      listDir("plugins", "software-factory", "agents"),
      AGENTS.map((a) => `${a}.md`),
    );
    for (const a of AGENTS) {
      assert.match(agent(a), new RegExp(`^name: ${a}$`, "m"));
    }
  });

  it("has an MIT license", () => {
    assert.match(read("LICENSE"), /MIT License/);
  });

  it("has a README with the machine install steps", () => {
    const readme = read("README.md");
    assert.match(readme, /claude plugin marketplace add VTHoop\/software-factory/);
    assert.match(readme, /claude plugin install software-factory@software-factory/);
  });

  it("keeps everything else out of the plugin directory", () => {
    assert.ok(!exists("plugins", "software-factory", "tests"));
    assert.ok(!exists("plugins", "software-factory", "scripts"));
  });
});

describe("CI", () => {
  const ci = () => read(".github", "workflows", "ci.yml");

  it("runs the tests and plugin validation", () => {
    assert.match(ci(), /node --test/);
    assert.match(ci(), /plugin validate \./);
    assert.match(ci(), /plugin validate plugins\/software-factory/);
  });

  it("pins Claude Code to an exact version", () => {
    assert.match(ci(), /@anthropic-ai\/claude-code@\d+\.\d+\.\d+/);
  });

  it("fails a tag that does not match the plugin version", () => {
    assert.match(ci(), /GITHUB_REF_NAME/);
    assert.match(ci(), /plugin\.json/);
  });
});
