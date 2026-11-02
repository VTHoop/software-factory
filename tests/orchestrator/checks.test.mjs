import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { judgeRun, parseLimit, signedIn } from "../../orchestrator/checks.mjs";
import { byType, output, REVIEWERS, reviewOutput } from "./fakes.mjs";

const opts = { maxTurns: 80 };

describe("signedIn", () => {
  it("accepts a signed-in `claude auth status`", () => {
    assert.deepEqual(signedIn('{"loggedIn":true,"authMethod":"claude.ai"}'), { ok: true });
  });

  it("stops with a clear message when signed out", () => {
    const r = signedIn('{"loggedIn":false}');
    assert.equal(r.ok, false);
    assert.match(r.message, /claude auth login/);
  });

  it("treats unreadable status as signed out", () => {
    assert.equal(signedIn("not json").ok, false);
  });
});

describe("judgeRun", () => {
  it("passes a finished run", () => {
    assert.deepEqual(judgeRun(output(), opts), { ok: true });
  });

  it("escalates a stopped result with its reason", () => {
    const r = judgeRun(
      output({ result: 'x\nSOFTWARE_FACTORY_RESULT: {"status":"stopped","reason":"dirty tree"}' }),
      opts,
    );
    assert.equal(r.ok, false);
    assert.equal(r.kind, "stopped");
    assert.match(r.reason, /dirty tree/);
  });

  it("fails a run with no result line", () => {
    const r = judgeRun(output({ result: "I think I'm done." }), opts);
    assert.equal(r.kind, "no-result");
  });

  it("fails a run with any permission denial, naming the denied commands", () => {
    const r = judgeRun(
      output({
        permission_denials: [{ tool_name: "Bash", tool_input: { command: "gh pr merge 7" } }],
      }),
      opts,
    );
    assert.equal(r.ok, false);
    assert.equal(r.kind, "denied");
    assert.deepEqual(r.denied, ["gh pr merge 7"]);
    assert.match(r.reason, /gh pr merge 7/);
  });

  it("fails a run that ended in an error, including a safeguard error", () => {
    const r = judgeRun(output({ is_error: true, terminal_reason: "safeguard", result: "blocked" }), opts);
    assert.equal(r.ok, false);
    assert.equal(r.kind, "error");
    assert.equal(r.retrySameSession, false);
  });

  it("fails a run that used more turns than the limit", () => {
    const r = judgeRun(output({ num_turns: 81 }), opts);
    assert.equal(r.kind, "turn-limit");
    assert.equal(r.resumable, false);
  });
});

describe("judgeRun for a review", () => {
  const review = { ...opts, expect: "review" };

  it("passes when all six reviewers started and finished", () => {
    assert.deepEqual(judgeRun(reviewOutput(), review), { ok: true });
  });

  it("fails when Sonnet reviewed inline and spawned no reviewers", () => {
    const r = judgeRun(output({ subagent_stats: { spawned: 0, by_type: {} } }), review);
    assert.equal(r.kind, "reviewers");
  });

  it("fails when a reviewer started but did not finish", () => {
    const stats = { by_type: { ...byType(), [REVIEWERS[0]]: { spawned: 1, completed: 0, failed: 1 } } };
    assert.equal(judgeRun(output({ subagent_stats: stats }), review).kind, "reviewers");
  });

  it("counts distinct reviewers, so respawns of one reviewer do not inflate the count", () => {
    const five = REVIEWERS.slice(0, 5);
    const stats = { by_type: { ...byType(five), [five[0]]: { spawned: 2, completed: 2, failed: 0 } } };
    const r = judgeRun(output({ subagent_stats: stats }), review);
    assert.equal(r.kind, "reviewers");
    assert.match(r.reason, /5 of 6/);
  });

  it("names the reviewers that are missing", () => {
    const r = judgeRun(output({ subagent_stats: { by_type: byType(REVIEWERS.slice(1)) } }), review);
    assert.match(r.reason, /sdlc-review-impact/);
  });
});

describe("parseLimit", () => {
  const now = new Date("2026-11-02T20:00:00Z");

  it("is null for an ordinary run", () => {
    assert.equal(parseLimit(output(), { now }), null);
  });

  it("reads the reset time from a usage-limit result", () => {
    const epoch = Math.floor(new Date("2026-11-03T01:00:00Z").getTime() / 1000);
    const r = parseLimit(output({ is_error: true, result: `Claude AI usage limit reached|${epoch}` }), { now });
    assert.equal(r.resetAt.toISOString(), "2026-11-03T01:00:00.000Z");
  });

  it("falls back to a wait from now when no reset time can be read", () => {
    const r = parseLimit(output({ is_error: true, result: "Claude usage limit reached." }), {
      now,
      fallbackMs: 3_600_000,
    });
    assert.equal(r.resetAt.toISOString(), "2026-11-02T21:00:00.000Z");
  });
});
