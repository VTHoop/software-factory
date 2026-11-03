import assert from "node:assert/strict";
import { existsSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { acquireLock, isPaused, loadState, recover, releaseLock, saveState } from "../../orchestrator/state.mjs";
import { tmp } from "./fakes.mjs";

const dir = () => tmp("sf-state-");

describe("state on disk", () => {
  it("starts empty", () => {
    assert.deepEqual(loadState(dir()), { tickets: [], pausedUntil: null });
  });

  it("survives a restart", () => {
    const d = dir();
    const state = { tickets: [{ key: "HEA-1", phase: "implemented", sessionId: "s" }], pausedUntil: null };
    saveState(d, state);
    assert.deepEqual(loadState(d), state);
  });

  it("never leaves a half-written file behind", () => {
    const d = dir();
    saveState(d, { tickets: [], pausedUntil: null });
    assert.ok(!existsSync(join(d, "state.json.tmp")));
  });
});

describe("lock", () => {
  it("lets a second invocation see that one is already running", () => {
    const d = dir();
    const release = acquireLock(d);
    assert.equal(typeof release, "function");
    assert.equal(acquireLock(d), null);
    release();
    assert.equal(typeof acquireLock(d), "function");
  });

  it("takes over a lock left by a process that is gone", () => {
    const d = dir();
    writeFileSync(join(d, "lock"), "999999999");
    assert.equal(typeof acquireLock(d), "function");
  });
});

describe("lock ownership", () => {
  it("does not remove a lock that another live process now holds", () => {
    const d = dir();
    const release = acquireLock(d);
    writeFileSync(join(d, "lock"), String(process.ppid));
    release();
    assert.ok(existsSync(join(d, "lock")));
  });

  it("treats a lock file with no readable PID, just written, as held", () => {
    const d = dir();
    writeFileSync(join(d, "lock"), "");
    assert.equal(acquireLock(d), null);
  });

  it("takes over an unreadable lock file once it is old", () => {
    const d = dir();
    writeFileSync(join(d, "lock"), "");
    const old = new Date(Date.now() - 60_000);
    utimesSync(join(d, "lock"), old, old);
    assert.equal(typeof acquireLock(d), "function");
  });

  it("releaseLock removes this process's lock, for a signal handler to call", () => {
    const d = dir();
    acquireLock(d);
    releaseLock(d);
    assert.ok(!existsSync(join(d, "lock")));
  });
});

describe("pause file", () => {
  it("is off by default and on when the file exists", () => {
    const d = dir();
    assert.equal(isPaused(d), false);
    writeFileSync(join(d, "pause"), "");
    assert.equal(isPaused(d), true);
  });
});

describe("recover", () => {
  it("resumes a run cut off by a restart once", () => {
    const t = { key: "HEA-1", phase: "implemented", running: { startedAt: "t" } };
    const r = recover(t);
    assert.equal(r.action, "resume");
    assert.equal(r.ticket.running.resumedOnce, true);
  });

  it("escalates a run that was already resumed once", () => {
    const t = { key: "HEA-1", phase: "implemented", running: { startedAt: "t", resumedOnce: true } };
    assert.equal(recover(t).action, "escalate");
  });

  it("does nothing for a ticket between runs", () => {
    assert.equal(recover({ key: "HEA-1", phase: "implemented" }).action, "none");
  });
});
