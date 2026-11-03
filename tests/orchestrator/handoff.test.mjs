import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHandoff, handoff, parseManualTest, parseResponse, waitForCi } from "../../orchestrator/handoff.mjs";

const prBody = `Summary.

## Owner manual test

### Before testing

- Apply migration 0007 to the hosted database
- Check the real USDA key

### Checklist

- [ ] Search a branded food
- [ ] Log a serving
`;

const response = `## Response to /pr-review

| #   | Finding  | Severity | Disposition            | Evidence |
| --- | -------- | -------- | ---------------------- | -------- |
| 1   | Null id  | Major    | Fixed                  | \`abc\` |
| 2   | Naming   | Minor    | Dismissed              | \`a.ts:4\` handles it |
| 3   | Pagination | Major  | Deferred — needs owner | Follow-up: paginate |

**Checks:** all green`;

describe("parseManualTest", () => {
  it("splits the before-testing items from the checklist", () => {
    const r = parseManualTest(prBody);
    assert.deepEqual(r.before, ["Apply migration 0007 to the hosted database", "Check the real USDA key"]);
    assert.deepEqual(r.checklist, ["Search a branded food", "Log a serving"]);
  });

  it("returns empty lists when the PR has no such section", () => {
    assert.deepEqual(parseManualTest("nothing"), { before: [], checklist: [] });
  });
});

describe("parseResponse", () => {
  it("lists every dismissal and deferral", () => {
    const r = parseResponse(response);
    assert.deepEqual(r.dismissed.map((d) => d.finding), ["Naming"]);
    assert.deepEqual(r.deferred.map((d) => d.finding), ["Pagination"]);
  });
});

describe("buildHandoff", () => {
  const input = {
    key: "HEA-1",
    pr: { number: 7, url: "https://gh/pr/7", previewUrl: "https://preview.example" },
    prBody,
    response,
    outcome: "Approved",
    ci: { state: "success" },
    freshAnswer: false,
  };

  it("carries the PR and preview links, test checklist, before-testing steps, outcome and CI", () => {
    const { message } = buildHandoff(input);
    for (const part of ["https://gh/pr/7", "https://preview.example", "Search a branded food", "migration 0007", "Approved", "success"]) {
      assert.ok(message.includes(part), `missing ${part}`);
    }
  });

  it("lists every dismissal and deferral", () => {
    const { message } = buildHandoff(input);
    assert.match(message, /Naming/);
    assert.match(message, /Pagination/);
  });

  it("says when the answer ran in a fresh session", () => {
    assert.match(buildHandoff({ ...input, freshAnswer: true }).message, /fresh session/i);
    assert.doesNotMatch(buildHandoff(input).message, /fresh session/i);
  });

  it("is a handoff notification", () => {
    assert.equal(buildHandoff(input).kind, "handoff");
  });
});

describe("waitForCi", () => {
  it("returns the result once CI finishes", async () => {
    const states = ["pending", "pending", "success"];
    const r = await waitForCi({ getState: async () => states.shift(), sleep: async () => {}, timeoutMs: 1000, intervalMs: 1 });
    assert.equal(r.state, "success");
  });

  it("stops waiting at the time limit and reports it", async () => {
    let t = 0;
    const r = await waitForCi({
      getState: async () => "pending",
      sleep: async (ms) => void (t += ms),
      now: () => t,
      timeoutMs: 100,
      intervalMs: 30,
    });
    assert.equal(r.state, "timed-out");
  });
});

describe("handoff", () => {
  it("waits for CI on the head commit, notifies, then moves the issue to In Review", async () => {
    const calls = [];
    const deps = {
      config: { ciTimeoutMs: 1000, ciIntervalMs: 1 },
      sleep: async () => {},
      github: {
        headSha: async () => (calls.push("headSha"), "abc123"),
        ciState: async (sha) => (calls.push(`ci:${sha}`), "success"),
        prDetails: async () => ({ number: 7, url: "u", previewUrl: "p", body: prBody }),
        response: async () => response,
      },
      notify: async (n) => void calls.push(`notify:${n.kind}`),
      linear: { setStatus: async (k, s) => void calls.push(`status:${s}`) },
    };
    const result = await handoff({ key: "HEA-1", pr: 7, outcome: "Approved" }, deps);
    assert.deepEqual(calls, ["headSha", "ci:abc123", "notify:handoff", "status:In Review"]);
    assert.equal(result.phase, "handed-off");
  });
});
