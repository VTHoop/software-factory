import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextAction } from "../../orchestrator/flow.mjs";

const ticket = (over) => ({ key: "HEA-1", pr: 7, sessionId: "sess-1", reviews: 1, ...over });

describe("nextAction", () => {
  it("implements a claimed ticket", () => {
    assert.deepEqual(nextAction(ticket({ phase: "claimed", pr: null })), { type: "implement" });
  });

  it("reviews once the PR exists", () => {
    assert.deepEqual(nextAction(ticket({ phase: "implemented", reviews: 0 })), {
      type: "review",
      pr: 7,
    });
  });

  it("answers an Approved first review too, because it can still carry findings", () => {
    assert.deepEqual(nextAction(ticket({ phase: "reviewed", outcome: "Approved" })), {
      type: "answer",
      pr: 7,
      resume: "sess-1",
    });
  });

  it("hands off a second review that is Approved", () => {
    assert.deepEqual(nextAction(ticket({ phase: "reviewed", outcome: "Approved", reviews: 2 })), {
      type: "handoff",
    });
  });

  it("hands off after answering an Approved review, with no re-review", () => {
    assert.deepEqual(nextAction(ticket({ phase: "answered", outcome: "Approved" })), {
      type: "handoff",
    });
  });

  for (const outcome of ["Needs Revision", "Blocked"]) {
    it(`answers a first review of ${outcome} by resuming the implementer session`, () => {
      assert.deepEqual(nextAction(ticket({ phase: "reviewed", outcome })), {
        type: "answer",
        pr: 7,
        resume: "sess-1",
      });
    });

    it(`escalates a second review of ${outcome} with the outcome, and runs no address-review`, () => {
      const action = nextAction(ticket({ phase: "reviewed", outcome, reviews: 2 }));
      assert.equal(action.type, "escalate");
      assert.match(action.reason, new RegExp(outcome));
    });
  }

  it("starts one more review after answering a review that was not Approved", () => {
    assert.deepEqual(nextAction(ticket({ phase: "answered", outcome: "Needs Revision" })), { type: "review", pr: 7 });
  });

  it("never reviews a third time", () => {
    const action = nextAction(ticket({ phase: "answered", outcome: "Blocked", reviews: 2 }));
    assert.notEqual(action.type, "review");
  });

  it("escalates a failed run with its reason", () => {
    const action = nextAction(ticket({ phase: "failed", reason: "permission denied: rm -rf" }));
    assert.equal(action.type, "escalate");
    assert.match(action.reason, /permission denied/);
  });

  it("waits on a ticket that is already handed off", () => {
    assert.deepEqual(nextAction(ticket({ phase: "handed-off" })), { type: "wait" });
  });
});
