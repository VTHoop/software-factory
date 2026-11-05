import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { poll } from "../../orchestrator/poll.mjs";
import { loadState, saveState } from "../../orchestrator/state.mjs";
import { tmp } from "./fakes.mjs";

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
  const stateDir = tmp("sf-poll-");
  saveState(stateDir, { tickets, pausedUntil });
  const calls = [];
  const step = (name) => async (t) => (calls.push([name, t.key]), { ...t, phase: "implemented" });
  const deps = {
    calls,
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
    const tickets = [{ key: "HEA-4", phase: "implemented", running: { startedAt: "t", resumedOnce: true } }];
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
    const tickets = [{ key: "HEA-4", phase: "implemented", pr: 7, running: { startedAt: "t", resumedOnce: true } }];
    const { ctx, deps } = setup({ tickets });
    await poll(ctx);
    assert.ok(deps.calls.some((c) => c[0] === "escalate" && c[1] === "HEA-4"));
  });

  it("cleans up worktrees inside the lock and clears only the ones it removed", async () => {
    const tickets = [
      { key: "HEA-3", phase: "handed-off", pr: 3, worktree: "/wt/3" },
      { key: "HEA-4", phase: "handed-off", pr: 4, worktree: "/wt/4" },
    ];
    const { ctx, deps, stateDir } = setup({ issues: [ready], tickets });
    let lockHeld;
    deps.cleanup = async () => {
      lockHeld = existsSync(join(stateDir, "lock"));
      return ["HEA-3"];
    };
    await poll(ctx);
    assert.equal(lockHeld, true);
    const saved = loadState(stateDir);
    const byKey = Object.fromEntries(saved.tickets.map((t) => [t.key, t]));
    assert.equal(byKey["HEA-3"].worktree, undefined);
    assert.equal(byKey["HEA-4"].worktree, "/wt/4");
    assert.ok(byKey["HEA-5"], "the step's update was kept");
  });

  it("cleans up even when there is nothing else to do", async () => {
    const tickets = [{ key: "HEA-3", phase: "handed-off", pr: 3, worktree: "/wt/3" }];
    const { ctx, deps, stateDir } = setup({ tickets });
    deps.cleanup = async () => ["HEA-3"];
    await poll(ctx);
    assert.equal(loadState(stateDir).tickets[0].worktree, undefined);
  });

  it("does not clean up when another invocation holds the lock", async () => {
    const { ctx, deps, stateDir } = setup({ tickets: [{ key: "HEA-3", phase: "handed-off", pr: 3, worktree: "/wt/3" }] });
    writeFileSync(join(stateDir, "lock"), String(process.pid));
    deps.cleanup = async () => assert.fail("cleaned up outside the lock");
    await poll(ctx);
  });

  it("passes the ticket to the preflight, so it can check what that ticket's repo needs", async () => {
    const seen = [];
    const { ctx, deps } = setup({ issues: [ready] });
    deps.preflight = async (ticket) => void seen.push(ticket.key);
    await poll({ ...ctx, deps });
    assert.deepEqual(seen, ["HEA-5"]);
  });

  it("leaves the ticket untouched, escalates nothing and frees the lock when the preflight fails", async () => {
    const { ctx, deps, stateDir } = setup({ issues: [ready] });
    deps.preflight = async () => {
      throw new Error("Docker is not ready");
    };
    await assert.rejects(poll({ ...ctx, deps }), /Docker is not ready/);
    assert.deepEqual(deps.calls, []);
    assert.deepEqual(loadState(stateDir).tickets, []);
    assert.equal(existsSync(join(stateDir, "lock")), false);
    deps.preflight = async () => {};
    await poll({ ...ctx, deps });
    assert.deepEqual(deps.calls, [["implement", "HEA-5"]]);
  });
});

describe("poll when an escalation itself fails", () => {
  const failing = { phase: "failed", reason: "Permission denied: edit .github/ci.yml" };
  const broken = () => {
    const h = setup({ issues: [ready] });
    h.deps.run.implement = async (t) => ({ ...t, ...failing });
    h.deps.run.escalate = async () => {
      throw new Error("No label named needs-owner");
    };
    return h;
  };

  it("surfaces the escalation's error", async () => {
    const { ctx } = broken();
    await assert.rejects(poll(ctx), /No label named needs-owner/);
  });

  it("keeps the failure and its reason, and clears the run, so it is not later read as a restart", async () => {
    const { ctx, stateDir } = broken();
    await assert.rejects(poll(ctx));
    const [ticket] = loadState(stateDir).tickets;
    assert.equal(ticket.phase, "failed");
    assert.equal(ticket.reason, failing.reason);
    assert.equal(ticket.running, undefined);
  });

  it("retries only the escalation on the next poll, with the original reason", async () => {
    const { ctx, deps, stateDir } = broken();
    await assert.rejects(poll(ctx));
    deps.run.escalate = async (t, reason) => (deps.calls.push(["escalate", t.key, reason]), { ...t, phase: "escalated" });
    deps.calls.length = 0;
    await poll(ctx);
    assert.deepEqual(deps.calls, [["escalate", "HEA-5", failing.reason]]);
    assert.equal(loadState(stateDir).tickets[0].phase, "escalated");
  });

  it("does the same when the escalation that fails is for a run cut off twice", async () => {
    const tickets = [{ key: "HEA-4", phase: "claimed", running: { step: "implement", startedAt: "x", resumedOnce: true } }];
    const { ctx, deps, stateDir } = setup({ tickets });
    deps.run.escalate = async () => {
      throw new Error("No label named needs-owner");
    };
    await assert.rejects(poll(ctx), /needs-owner/);
    const [ticket] = loadState(stateDir).tickets;
    assert.equal(ticket.phase, "failed");
    assert.match(ticket.reason, /cut off by a restart/);
    assert.equal(ticket.running, undefined);
  });
});
