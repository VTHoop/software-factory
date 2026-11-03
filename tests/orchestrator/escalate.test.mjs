import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escalate } from "../../orchestrator/escalate.mjs";

const make = () => {
  const calls = [];
  const rec = (name) => async (...a) => void calls.push([name, ...a]);
  return {
    calls,
    deps: {
      linear: { comment: rec("linear.comment"), addLabel: rec("linear.addLabel"), setStatus: rec("linear.setStatus") },
      github: { comment: rec("github.comment") },
      notify: rec("notify"),
    },
  };
};
const named = (calls, n) => calls.filter((c) => c[0] === n);

describe("escalate", () => {
  it("comments the reason on the Linear issue and the PR, and adds needs-owner", async () => {
    const { calls, deps } = make();
    await escalate({ key: "HEA-1", pr: 7, prUrl: "https://gh/pr/7" }, "second review: Blocked", deps);
    assert.match(named(calls, "linear.comment")[0][2], /second review: Blocked/);
    assert.match(named(calls, "github.comment")[0][2], /second review: Blocked/);
    assert.deepEqual(named(calls, "linear.addLabel")[0].slice(1), ["HEA-1", "needs-owner"]);
  });

  it("moves a ticket with no PR back to Todo", async () => {
    const { calls, deps } = make();
    await escalate({ key: "HEA-1", pr: null }, "stopped: no AC", deps);
    assert.deepEqual(named(calls, "linear.setStatus")[0].slice(1), ["HEA-1", "Todo"]);
    assert.equal(named(calls, "github.comment").length, 0);
  });

  it("leaves the status of a ticket that has a PR alone", async () => {
    const { calls, deps } = make();
    await escalate({ key: "HEA-1", pr: 7 }, "why", deps);
    assert.equal(named(calls, "linear.setStatus").length, 0);
  });

  it("notifies with the reason and links", async () => {
    const { calls, deps } = make();
    await escalate({ key: "HEA-1", pr: 7, prUrl: "https://gh/pr/7", issueUrl: "https://lin/HEA-1" }, "denied: rm", deps);
    const n = named(calls, "notify")[0][1];
    assert.equal(n.kind, "escalation");
    assert.match(n.message, /denied: rm/);
    assert.match(`${n.message} ${n.url}`, /gh\/pr\/7|lin\/HEA-1/);
  });

  it("puts denied commands in the comment", async () => {
    const { calls, deps } = make();
    await escalate({ key: "HEA-1", pr: 7 }, "run denied", deps, { denied: ["gh pr merge 7"] });
    assert.match(named(calls, "linear.comment")[0][2], /gh pr merge 7/);
  });

  it("marks the ticket escalated", async () => {
    const { deps } = make();
    const result = await escalate({ key: "HEA-1", pr: 7, phase: "reviewing" }, "why", deps);
    assert.equal(result.phase, "escalated");
    assert.equal(result.reason, "why");
  });

  it("adds the label and status before it posts any comment, so a failing step posts nothing twice", async () => {
    const { calls, deps } = make();
    await escalate({ key: "HEA-1", pr: null }, "why", deps);
    const order = calls.map((c) => c[0]);
    assert.ok(order.indexOf("linear.addLabel") < order.indexOf("linear.comment"));
    assert.ok(order.indexOf("linear.setStatus") < order.indexOf("linear.comment"));
  });

  it("still marks the ticket escalated when the notification fails", async () => {
    const { deps } = make();
    deps.notify = async () => {
      throw new Error("Pushover returned HTTP 500");
    };
    const result = await escalate({ key: "HEA-1", pr: 7 }, "why", deps);
    assert.equal(result.phase, "escalated");
    assert.match(result.notifyError, /Pushover/);
  });

  it("redacts secrets in the reason before it reaches Linear, the PR or Pushover", async () => {
    const { calls, deps } = make();
    const token = "ghp_" + "a".repeat(24);
    await escalate({ key: "HEA-1", pr: 7 }, `run failed: GH_TOKEN=${token}`, deps);
    for (const call of calls) assert.ok(!JSON.stringify(call).includes(token), call[0]);
  });
});
