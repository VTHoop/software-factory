import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exec } from "../../orchestrator/exec.mjs";

const node = process.execPath;

describe("exec", () => {
  it("resolves with stdout", async () => {
    const r = await exec(node, ["-e", "console.log('hi')"], { timeoutMs: 5000 });
    assert.equal(r.stdout.trim(), "hi");
  });

  it("passes input on stdin", async () => {
    const r = await exec(node, ["-e", "process.stdin.pipe(process.stdout)"], { timeoutMs: 5000, input: "body" });
    assert.equal(r.stdout, "body");
  });

  it("rejects a hung command at its time limit instead of waiting forever", async () => {
    const started = Date.now();
    await assert.rejects(exec(node, ["-e", "setTimeout(()=>{},30000)"], { timeoutMs: 200 }));
    assert.ok(Date.now() - started < 5000);
  });

  it("has a default time limit", async () => {
    const { DEFAULT_TIMEOUT_MS } = await import("../../orchestrator/exec.mjs");
    assert.ok(DEFAULT_TIMEOUT_MS > 0 && DEFAULT_TIMEOUT_MS <= 300_000);
  });
});
