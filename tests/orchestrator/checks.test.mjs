import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deniedCommands, judgeRun, outcomeOf, parseLimit, REVIEWERS as NAMES, redact, dockerReady, signedIn } from "../../orchestrator/checks.mjs";
import { AGENTS } from "../lib.mjs";
import { byType, output, REVIEWERS, reviewOutput } from "./fakes.mjs";

const opts = { maxRunCostUsd: 4 };

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
  });

  it("passes a finished run however many turns it took", () => {
    assert.deepEqual(judgeRun(output({ num_turns: 97 }), opts), { ok: true });
  });

  it("names the spend cap when a run reaches it", () => {
    const r = judgeRun(
      output({ is_error: true, subtype: "error_max_budget_usd", terminal_reason: "budget_exhausted", result: null }),
      opts,
    );
    assert.equal(r.ok, false);
    assert.equal(r.kind, "budget");
    assert.match(r.reason, /\$4 /);
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
    const stats = { spawned: 6, completed: 5, failed: 1, by_type: byType() };
    assert.equal(judgeRun(output({ subagent_stats: stats }), review).kind, "reviewers");
  });

  it("fails when fewer reviewers finished than started", () => {
    const stats = { spawned: 6, completed: 4, failed: 0, by_type: byType() };
    assert.equal(judgeRun(output({ subagent_stats: stats }), review).kind, "reviewers");
  });

  it("counts distinct reviewers, so respawns of one reviewer do not inflate the count", () => {
    const five = REVIEWERS.slice(0, 5);
    const stats = { spawned: 6, completed: 6, failed: 0, by_type: { ...byType(five), [five[0]]: 2 } };
    const r = judgeRun(output({ subagent_stats: stats }), review);
    assert.equal(r.kind, "reviewers");
    assert.match(r.reason, /5 of 6/);
  });

  it("names the reviewers that are missing", () => {
    const stats = { spawned: 5, completed: 5, failed: 0, by_type: byType(REVIEWERS.slice(1)) };
    const r = judgeRun(output({ subagent_stats: stats }), review);
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

describe("REVIEWERS", () => {
  it("names the six review agents the plugin ships", () => {
    assert.deepEqual(NAMES.map((n) => `sdlc-review-${n}`).sort(), [...AGENTS].sort());
  });
});

describe("redact", () => {
  const fake = {
    bearer: "abc123def456",
    linear: `lin_api_${"a".repeat(20)}`,
    anthropic: `sk-ant-${"a".repeat(20)}`,
    github: `ghp_${"a".repeat(24)}`,
  };

  it("masks tokens and bearer credentials", () => {
    const text = `curl -H 'Authorization: Bearer ${fake.bearer}' KEY=${fake.linear} ${fake.anthropic} ${fake.github}`;
    const out = redact(text);
    for (const secret of Object.values(fake)) assert.ok(!out.includes(secret), `${secret} leaked`);
  });

  it("truncates a long command", () => {
    assert.ok(redact("x".repeat(1000)).length <= 220);
  });

  it("is applied to the denied commands a judged run reports", () => {
    const out = output({
      permission_denials: [{ tool_name: "Bash", tool_input: { command: `echo ${fake.github}` } }],
    });
    assert.ok(!deniedCommands(out).join(" ").includes(fake.github));
    assert.ok(!judgeRun(out, opts).reason.includes(fake.github));
  });
});

describe("redact patterns", () => {
  it("masks a lowercase token= argument", () => {
    assert.ok(!redact("curl https://x?token=abcdef123456").includes("abcdef123456"));
  });
  it("masks a fine-grained GitHub token", () => {
    const token = "github_pat_" + "A1b2C3d4E5".repeat(4);
    assert.ok(!redact(`gh auth login --with-token ${token}`).includes(token));
  });
  it("masks a JWT", () => {
    const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTYifQ", "c2lnbmF0dXJlMTIzNDU2"].join(".");
    assert.ok(!redact(`curl -H "x: ${jwt}"`).includes(jwt));
  });
});

describe("parseLimit guards", () => {
  const now = new Date("2026-11-02T20:00:00Z");

  it("ignores limit text in a run that did not end in an error", () => {
    const r = parseLimit(output({ is_error: false, result: "usage limit reached|9999999999" }), { now });
    assert.equal(r, null);
  });

  it("caps a reset time far in the future", () => {
    const r = parseLimit(output({ is_error: true, result: "usage limit reached|9999999999" }), { now });
    assert.ok(r.resetAt.getTime() - now.getTime() <= 7 * 24 * 3_600_000);
  });
});

describe("dockerReady", () => {
  it("is ok when `docker info` succeeds", async () => {
    assert.deepEqual(await dockerReady(async () => ({ stdout: "ok" })), { ok: true });
  });

  it("is not ok, with a message that says to wait, when `docker info` fails", async () => {
    const r = await dockerReady(async () => {
      throw new Error("Cannot connect to the Docker daemon");
    });
    assert.equal(r.ok, false);
    assert.match(r.message, /Docker is not ready/);
  });
});

describe("redact private keys", () => {
  it("masks a PEM private key, however it is wrapped", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEabc123\nxyz\n-----END RSA PRIVATE KEY-----";
    assert.ok(!redact(`cat it: ${pem}`).includes("MIIEabc123"));
    assert.ok(!redact("-----BEGIN PRIVATE KEY-----\nMIIEabc123").includes("MIIEabc123"));
  });

  it("masks an installation token", () => {
    assert.ok(!redact(`x ghs_${"a".repeat(30)}`).includes("ghs_aaa"));
  });
});

describe("outcomeOf", () => {
  const review = (outcome) => `## PR Review\n\n**Overall:** ${outcome}\n\n---\n*Generated by \`/pr-review\`*`;

  it("reads the Overall line of a review body", () => {
    assert.equal(outcomeOf(review("Blocked")), "Blocked");
  });

  it("is null for a body without the Generated by marker or an Overall line", () => {
    assert.equal(outcomeOf("**Overall:** Approved"), null);
    assert.equal(outcomeOf("## PR Review\n*Generated by `/pr-review`*"), null);
  });
});
