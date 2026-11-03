import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answer, implement, review } from "../../orchestrator/steps.mjs";
import { makeDeps, output, reviewOutput } from "./fakes.mjs";

const claimed = { key: "HEA-1", branch: "pathooper83/hea-1-do-it", phase: "claimed", reviews: 0 };
const withPr = { ...claimed, phase: "implemented", pr: 7, sessionId: "sess-1", worktree: "/work/wt/hea-1" };
const names = (deps) => deps.calls.map((c) => c[0]);
const claudeCall = (deps) => deps.calls.find((c) => c[0] === "claude")[1];

describe("implement", () => {
  it("moves the issue to In Progress before starting the run", async () => {
    const deps = makeDeps();
    await implement(claimed, deps);
    assert.ok(names(deps).indexOf("linear.setStatus") < names(deps).indexOf("claude"));
    assert.deepEqual(deps.calls[0], ["linear.setStatus", "HEA-1", "In Progress"]);
  });

  it("runs start-ticket --unattended in a new worktree from the base branch", async () => {
    const deps = makeDeps();
    await implement(claimed, deps);
    assert.deepEqual(deps.calls.find((c) => c[0] === "git.addWorktree")[1], {
      repo: "/work/repo",
      branch: "pathooper83/hea-1-do-it",
      base: "main",
    });
    const call = claudeCall(deps);
    assert.equal(call.prompt, "/software-factory:start-ticket HEA-1 --unattended");
    assert.equal(call.cwd, "/work/wt/hea-1");
  });

  it("saves the session ID and the PR", async () => {
    const result = await implement(claimed, makeDeps());
    assert.equal(result.sessionId, "sess-1");
    assert.equal(result.pr, 7);
    assert.equal(result.phase, "implemented");
  });

  it("fails the ticket, with the reason, when the skill stops", async () => {
    const stopped = output({
      result: 'x\nSOFTWARE_FACTORY_RESULT: {"status":"stopped","reason":"no AC"}',
    });
    const result = await implement(claimed, makeDeps({ claude: async () => stopped }));
    assert.equal(result.phase, "failed");
    assert.match(result.reason, /no AC/);
  });

  it("fails the ticket when the run finishes without a PR", async () => {
    const deps = makeDeps({ github: { findPr: async () => null } });
    const result = await implement(claimed, deps);
    assert.equal(result.phase, "failed");
    assert.match(result.reason, /PR/);
  });
});

describe("review", () => {
  it("runs pr-review --unattended as a new session in its own checkout", async () => {
    const deps = makeDeps({ claude: async (c) => (deps.calls.push(["claude", c]), reviewOutput()) });
    await review(withPr, deps);
    const call = claudeCall(deps);
    assert.equal(call.prompt, "/software-factory:pr-review 7 --unattended");
    assert.equal(call.resume, undefined);
    assert.equal(call.cwd, "/work/review/pr-7");
    assert.notEqual(call.cwd, withPr.worktree);
  });

  it("records the outcome and counts the review", async () => {
    const deps = makeDeps({ claude: async () => reviewOutput() });
    const result = await review(withPr, deps);
    assert.equal(result.phase, "reviewed");
    assert.equal(result.outcome, "Approved");
    assert.equal(result.reviews, 1);
  });

  it("removes its checkout afterwards, so review checkouts do not pile up", async () => {
    const deps = makeDeps({ claude: async () => reviewOutput() });
    await review(withPr, deps);
    assert.deepEqual(deps.calls.find((c) => c[0] === "git.removeWorktree").slice(1), ["/work/repo", "/work/review/pr-7"]);
  });

  it("removes its checkout even when the run fails or throws", async () => {
    const stopped = makeDeps({ claude: async () => output({ is_error: true }) });
    await review(withPr, stopped);
    assert.ok(stopped.calls.some((c) => c[0] === "git.removeWorktree"));
    const throwing = makeDeps({ claude: async () => { throw Object.assign(new Error("limit"), { planLimit: {} }); } });
    await assert.rejects(review(withPr, throwing));
    assert.ok(throwing.calls.some((c) => c[0] === "git.removeWorktree"));
  });

  it("fails the ticket when the six reviewers did not all run", async () => {
    const shortcut = output({ subagent_stats: { spawned: 0, by_type: {} } });
    const result = await review(withPr, makeDeps({ claude: async () => shortcut }));
    assert.equal(result.phase, "failed");
    assert.match(result.reason, /reviewer/i);
  });
});

describe("answer", () => {
  const reviewed = { ...withPr, phase: "reviewed", outcome: "Needs Revision", reviews: 1 };

  it("resumes the saved implementer session", async () => {
    const deps = makeDeps({ claude: async (c) => (deps.calls.push(["claude", c]), output()) });
    const result = await answer(reviewed, deps);
    const call = claudeCall(deps);
    assert.equal(call.prompt, "/software-factory:address-review 7 --unattended");
    assert.equal(call.resume, "sess-1");
    assert.equal(result.phase, "answered");
    assert.equal(result.freshAnswer, undefined);
  });

  it("runs in a fresh session when the saved one can't be resumed, and records it", async () => {
    const resumes = [];
    const claude = async (c) => {
      resumes.push(c.resume);
      if (c.resume) throw Object.assign(new Error("no conversation found"), { code: "RESUME_FAILED" });
      return output({ session_id: "sess-2" });
    };
    const result = await answer(reviewed, makeDeps({ claude }));
    assert.deepEqual(resumes, ["sess-1", undefined]);
    assert.equal(result.phase, "answered");
    assert.equal(result.freshAnswer, true);
  });

  it("does not retry a resumed session that ended in an error", async () => {
    let runs = 0;
    const claude = async () => (runs++, output({ is_error: true, result: "API Error" }));
    const result = await answer(reviewed, makeDeps({ claude }));
    assert.equal(runs, 1);
    assert.equal(result.phase, "failed");
  });
});

describe("every step", () => {
  it("passes the configured model explicitly", async () => {
    const deps = makeDeps({
      claude: async (c) => (deps.calls.push(["claude", c]), reviewOutput()),
    });
    deps.config.model = "sonnet-from-config";
    await implement(claimed, deps);
    await review(withPr, deps);
    await answer({ ...withPr, phase: "reviewed", outcome: "Blocked", reviews: 1 }, deps);
    const models = deps.calls.filter((c) => c[0] === "claude").map((c) => c[1].model);
    assert.deepEqual(models, ["sonnet-from-config", "sonnet-from-config", "sonnet-from-config"]);
  });
});

describe("implement guards", () => {
  it("never touches git or gh with a branch name that is not valid", async () => {
    const deps = makeDeps();
    const result = await implement({ ...claimed, branch: "x;touch pwned" }, deps);
    assert.equal(result.phase, "failed");
    assert.ok(!names(deps).includes("git.addWorktree"));
    assert.ok(!names(deps).includes("github.findPr"));
    assert.ok(!names(deps).includes("claude"));
  });

  it("fails the ticket, naming the time limit, when the run times out", async () => {
    const claude = async () => {
      throw Object.assign(new Error("Run timed out"), { timedOut: true });
    };
    const result = await implement(claimed, makeDeps({ claude }));
    assert.equal(result.phase, "failed");
    assert.equal(result.kind, "timeout");
    assert.match(result.reason, /time limit/);
  });

  it("removes the new worktree when the run throws, so a retry does not collide with it", async () => {
    const deps = makeDeps({
      claude: async () => {
        throw new Error("boom");
      },
    });
    await assert.rejects(implement(claimed, deps), /boom/);
    assert.deepEqual(deps.calls.find((c) => c[0] === "git.removeWorktree").slice(1), ["/work/repo", "/work/wt/hea-1"]);
  });

  it("removes the new worktree on a plan limit too", async () => {
    const deps = makeDeps({
      claude: async () => {
        throw Object.assign(new Error("limit"), { planLimit: {} });
      },
    });
    await assert.rejects(implement(claimed, deps));
    assert.ok(names(deps).includes("git.removeWorktree"));
  });
});

describe("review guards", () => {
  it("fails the ticket when the run finishes but no trusted review comment exists", async () => {
    const deps = makeDeps({
      claude: async () => reviewOutput(),
      github: { reviewOutcome: async () => null },
    });
    const result = await review(withPr, deps);
    assert.equal(result.phase, "failed");
    assert.equal(result.kind, "no-review");
    assert.match(result.reason, /no review comment/);
  });
});

describe("run log", () => {
  it("logs each run with denied commands redacted", async () => {
    const logged = [];
    const denied = output({
      permission_denials: [{ tool_name: "Bash", tool_input: { command: "curl -H 'Authorization: Bearer abc123def456' x" } }],
    });
    const deps = makeDeps({ claude: async () => denied, log: (r) => logged.push(r) });
    await implement(claimed, deps);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].key, "HEA-1");
    assert.equal(logged[0].step, "implement");
    assert.ok(!JSON.stringify(logged[0].denied).includes("abc123def456"));
    assert.equal(logged[0].denied.length, 1);
  });
});
