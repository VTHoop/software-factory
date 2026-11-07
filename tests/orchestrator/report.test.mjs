import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { render, summarize } from "../../orchestrator/report.mjs";

const run = (o) => ({ at: "2026-11-04T03:00:00Z", key: "HEA-1", step: "implement", costUsd: 1, durationMs: 60000, turns: 10, denied: [], subagents: { failed: 0 }, ...o });

describe("summarize", () => {
  it("totals cost, time and steps per ticket, and counts denials", () => {
    const s = summarize({ runs: [run({}), run({ step: "review", costUsd: 2, denied: ["rm"], at: "2026-11-04T04:00:00Z" })] });
    assert.equal(s.costs.length, 1);
    assert.equal(s.costs[0].costUsd, 3);
    assert.deepEqual(s.costs[0].steps, { implement: 1, review: 1 });
    assert.equal(s.costs[0].denied, 1);
    assert.equal(s.totalCostUsd, 3);
  });

  it("keeps event lines apart from run lines", () => {
    const s = summarize({ runs: [{ at: "x", event: "identity-failed", reason: "boom" }, run({})] });
    assert.equal(s.events.length, 1);
    assert.equal(s.costs.length, 1);
  });

  it("reports how long the running step has run", () => {
    const s = summarize({
      runs: [],
      state: { tickets: [{ key: "HEA-2", phase: "claimed", running: { step: "implement", startedAt: "2026-11-06T21:00:00Z" } }] },
      now: new Date("2026-11-06T21:12:00Z"),
    });
    assert.deepEqual(s.running, [{ key: "HEA-2", step: "implement", minutes: 12 }]);
  });

  it("collapses idle polls and repeated errors", () => {
    const idle = JSON.stringify({ acted: false, reason: "nothing eligible" });
    const s = summarize({ runs: [], outLines: [idle, idle, JSON.stringify({ acted: true, key: "HEA-1", action: "review" })], errLines: ["a", "a", "b"] });
    assert.deepEqual(s.polls, { total: 3, idle: 2, reasons: { "nothing eligible": 2 } });
    assert.deepEqual(s.errors, [{ message: "a", count: 2 }, { message: "b", count: 1 }]);
  });

  it("ignores unparseable lines", () => {
    assert.equal(summarize({ runs: [], outLines: ["{oops"] }).polls.total, 0);
  });
});

describe("render", () => {
  it("prints a running line and a cost total", () => {
    const text = render(summarize({ runs: [run({})] }));
    assert.match(text, /RUNNING\s+nothing/);
    assert.match(text, /total\s+\$\s*1\.00/);
  });
});
