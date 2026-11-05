import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exists, read } from "../lib.mjs";

// The Mac Mini runbook is private and kept out of git (see .gitignore), so these checks
// only run on a machine that has it.
const file = ["private", "mac-mini-runbook.md"];
const present = exists(...file);

describe("Mac Mini runbook (private)", { skip: !present && "private/mac-mini-runbook.md is not on this machine" }, () => {
  const text = () => read(...file);
  const steps = () => text().split("\n").filter((l) => /^\d+\.\s/.test(l));

  it("has steps, and each says who does it", () => {
    assert.ok(steps().length > 0);
    for (const step of steps()) assert.match(step, /\b(Owner|Agent):/, step);
  });

  it("keeps the Mini awake and restarting after a power failure", () => {
    assert.match(text(), /pmset -a .*sleep 0/);
    assert.match(text(), /autorestart 1/);
  });

  it("covers FileVault, auto-login, automatic updates and Docker at login", () => {
    for (const word of ["fdesetup status", "automatic login", "softwareupdate", "Docker"]) {
      assert.ok(text().toLowerCase().includes(word.toLowerCase()), `missing ${word}`);
    }
  });

  it("starts the script from a launchd agent every 5 minutes and logs stderr to a file", () => {
    assert.match(text(), /<key>StartInterval<\/key>\s*<integer>300<\/integer>/);
    assert.match(text(), /<key>StandardErrorPath<\/key>/);
    assert.match(text(), /LaunchAgents/);
  });

  it("sets git author and gh sign-in for the agent's own account", () => {
    for (const word of ["git config --global user.name", "git config --global user.email", "gh auth login"]) {
      assert.ok(text().includes(word), `missing ${word}`);
    }
  });

  it("limits the credentials to the Claude sign-in, the HEA Linear key and Pushover", () => {
    for (const word of ["LINEAR_HEA_API_KEY", "PUSHOVER_USER_KEY", "PUSHOVER_APP_TOKEN"]) {
      assert.ok(text().includes(word), `missing ${word}`);
    }
  });

  it("covers the stable channel, SSH over Tailscale and the trustedAuthors entry", () => {
    for (const word of ["stable", "Tailscale", "trustedAuthors"]) assert.ok(text().includes(word), `missing ${word}`);
  });
});
