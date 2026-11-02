import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { poll } from "../../orchestrator/poll.mjs";
import { loadState, saveState } from "../../orchestrator/state.mjs";

const now = new Date("2026-11-02T20:00:00Z");
const ready = {
  key: "HEA-5",
  status: "Ready",
  team: "Health Agent",
  project: "Sidekick",
  priority: 2,
  createdAt: "2026-11-01T00:00:00Z",
  labels: [],
  blockedBy: [],
  gitBranchName: "pathooper83/hea-5-x",
};

const setup = ({ issues = [], tickets = [], config = {}, pausedUntil = null } = {}) => {
  const stateDir = mkdtempSync(join(tmpdir(), "sf-poll-"));
  saveState(stateDir, { tickets, pausedUntil });
  const calls = [];
  const step = (name) => async (t) => (calls.push([name, t.key]), { ...t, phase: "implemented" });
  const deps = {
    calls,
    claude: async () => assert.fail("a poll with nothing to do must not call the model"),
    linear: { listIssues: async () => issues },
    run: {
      implement: step("implement"),
      review: step("review"),
      answer: step("answer"),
      handoff: step("handoff"),
      escalate: async (t, reason) => (calls.push(["escalate", t.key, reason]), { ...t, phase: "escalated" }),
    },
    notify: async (n) => void calls.push(["notify", n.kind, n.message]),
  };
  return { stateDir, deps, ctx: { stateDir, now, deps, config: { entries: [{ repo: "/r", team: "Health Agent" }], ...config } } };
};

describe("poll", () => {
  it("uses no model and exits cleanly when there is nothing to do", async () => {
    const { ctx, deps } = setup();
    const r = await poll(ctx);
    assert.equal(r.acted, false);
    assert.deepEqual(deps.calls, []);
  });

  it("starts the chosen Ready issue", async () => {
    const { ctx, deps } = setup({ issues: [ready] });
    const r = await poll(ctx);
    assert.equal(r.acted, true);
    assert.deepEqual(deps.calls, [["implement", "HEA-5"]]);
  });

  it("runs one step per invocation, then exits", async () => {
    const tickets = [{ key: "HEA-5", phase: "implemented", pr: 7, reviews: 0 }];
    const { ctx, deps } = setup({ tickets });
    await poll(ctx);
    assert.equal(deps.calls.length, 1);
  });

  it("saves the ticket's new phase to disk", async () => {
    const { ctx, stateDir } = setup({ issues: [ready] });
    await poll(ctx);
    assert.equal(loadState(stateDir).tickets[0].key, "HEA-5");
  });

  it("exits without acting when another invocation holds the lock", async () => {
    const { ctx, deps, stateDir } = setup({ issues: [ready] });
    writeFileSync(join(stateDir, "lock"), String(process.pid));
    const r = await poll(ctx);
    assert.equal(r.acted, false);
    assert.deepEqual(deps.calls, []);
  });

  it("starts nothing new while one of its own tickets holds the slot", async () => {
    const tickets = [{ key: "HEA-4", phase: "reviewing", running: { startedAt: "t", resumedOnce: true } }];
    const { ctx, deps } = setup({ issues: [ready], tickets });
    await poll(ctx);
    assert.ok(!deps.calls.some((c) => c[0] === "implement"));
  });

  it("starts the next ticket while a handed-off PR waits for the owner", async () => {
    const tickets = [{ key: "HEA-4", phase: "handed-off" }];
    const { ctx, deps } = setup({ issues: [ready], tickets });
    await poll(ctx);
    assert.deepEqual(deps.calls, [["implement", "HEA-5"]]);
  });

  it("stops new work, but not a run in progress, when the pause file exists", async () => {
    const tickets = [{ key: "HEA-4", phase: "implemented", pr: 7, reviews: 0 }];
    const { ctx, deps, stateDir } = setup({ issues: [ready], tickets });
    writeFileSync(join(stateDir, "pause"), "");
    await poll(ctx);
    assert.deepEqual(deps.calls, [["review", "HEA-4"]]);
    const idle = setup({ issues: [ready] });
    writeFileSync(join(idle.stateDir, "pause"), "");
    assert.equal((await poll(idle.ctx)).acted, false);
  });

  it("stops new work, but not a run in progress, when the entries list is empty", async () => {
    const tickets = [{ key: "HEA-4", phase: "implemented", pr: 7, reviews: 0 }];
    const { ctx, deps } = setup({ issues: [ready], tickets, config: { entries: [] } });
    await poll(ctx);
    assert.deepEqual(deps.calls, [["review", "HEA-4"]]);
    const idle = setup({ issues: [ready], config: { entries: [] } });
    assert.equal((await poll(idle.ctx)).acted, false);
  });

  it("does nothing while paused for a plan limit, and keeps the ticket's place", async () => {
    const tickets = [{ key: "HEA-4", phase: "implemented", pr: 7, reviews: 0 }];
    const { ctx, deps, stateDir } = setup({ tickets, pausedUntil: "2026-11-02T22:00:00Z" });
    const r = await poll(ctx);
    assert.equal(r.acted, false);
    assert.deepEqual(deps.calls, []);
    assert.equal(loadState(stateDir).tickets[0].phase, "implemented");
  });

  it("resumes work once the plan limit has reset", async () => {
    const tickets = [{ key: "HEA-4", phase: "implemented", pr: 7, reviews: 0 }];
    const { ctx, deps } = setup({ tickets, pausedUntil: "2026-11-02T19:00:00Z" });
    await poll(ctx);
    assert.deepEqual(deps.calls, [["review", "HEA-4"]]);
  });

  it("pauses, rather than escalates, when a step hits the plan limit, and notifies the reset time", async () => {
    const tickets = [{ key: "HEA-4", phase: "implemented", pr: 7, reviews: 0 }];
    const { ctx, deps, stateDir } = setup({ tickets });
    const resetAt = new Date("2026-11-03T01:00:00Z");
    deps.run.review = async () => {
      throw Object.assign(new Error("limit"), { planLimit: { resetAt } });
    };
    await poll(ctx);
    assert.ok(!deps.calls.some((c) => c[0] === "escalate"));
    const note = deps.calls.find((c) => c[0] === "notify");
    assert.equal(note[1], "pause");
    assert.match(note[2], /2026-11-03T01:00/);
    const saved = loadState(stateDir);
    assert.equal(saved.pausedUntil, resetAt.toISOString());
    assert.equal(saved.tickets[0].phase, "implemented");
  });

  it("escalates a run cut off twice by restarts instead of resuming it again", async () => {
    const tickets = [{ key: "HEA-4", phase: "reviewing", pr: 7, running: { startedAt: "t", resumedOnce: true } }];
    const { ctx, deps } = setup({ tickets });
    await poll(ctx);
    assert.ok(deps.calls.some((c) => c[0] === "escalate" && c[1] === "HEA-4"));
  });
});
