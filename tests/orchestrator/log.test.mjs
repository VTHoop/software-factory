import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { appendLog, runRecord } from "../../orchestrator/log.mjs";
import { reviewOutput } from "./fakes.mjs";

describe("runRecord", () => {
  it("records estimated usage, duration, turns and subagent counts", () => {
    const r = runRecord(reviewOutput({ total_cost_usd: 0.45, duration_ms: 180000, num_turns: 30 }), {
      key: "HEA-1",
      step: "review",
      at: "2026-11-02T20:00:00Z",
    });
    assert.equal(r.key, "HEA-1");
    assert.equal(r.step, "review");
    assert.equal(r.costUsd, 0.45);
    assert.equal(r.durationMs, 180000);
    assert.equal(r.turns, 30);
    assert.deepEqual(r.subagents, { spawned: 6, completed: 6, failed: 0 });
    assert.ok(r.models["claude-sonnet-5-5"]);
  });

  it("subtracts earlier runs, since a resumed session reports a running total", () => {
    const r = runRecord(reviewOutput({ total_cost_usd: 0.27 }), { key: "HEA-1", step: "answer", priorCostUsd: 0.19 });
    assert.ok(Math.abs(r.costUsd - 0.08) < 1e-9);
  });

  it("lists the denied commands", () => {
    const r = runRecord(
      reviewOutput({ permission_denials: [{ tool_name: "Bash", tool_input: { command: "gh pr merge 7" } }] }),
      { key: "HEA-1", step: "review" },
    );
    assert.deepEqual(r.denied, ["gh pr merge 7"]);
  });
});

describe("appendLog", () => {
  it("appends one JSON line per run", () => {
    const file = join(mkdtempSync(join(tmpdir(), "sf-log-")), "runs.jsonl");
    appendLog(file, { key: "HEA-1" });
    appendLog(file, { key: "HEA-2" });
    const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.key), ["HEA-1", "HEA-2"]);
  });
});
