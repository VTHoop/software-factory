import { REVIEWERS as NAMES } from "../../orchestrator/checks.mjs";

export const REVIEWERS = NAMES.map((n) => `software-factory:sdlc-review-${n}`);

export const finished = '\nSOFTWARE_FACTORY_RESULT: {"status":"finished"}';

export const byType = (types = REVIEWERS, over = {}) =>
  Object.fromEntries(types.map((t) => [t, { spawned: 1, completed: 1, failed: 0, ...over }]));

// The JSON `claude -p --output-format json` prints when a run ends.
export const output = (over = {}) => ({
  session_id: "sess-1",
  is_error: false,
  terminal_reason: "completed",
  num_turns: 12,
  duration_ms: 60_000,
  total_cost_usd: 0.2,
  permission_denials: [],
  modelUsage: { "claude-sonnet-5-5": { costUSD: 0.2 } },
  subagent_stats: { spawned: 0, completed: 0, failed: 0, by_type: {} },
  result: `Done.${finished}`,
  ...over,
});

export const reviewOutput = (over = {}) =>
  output({
    subagent_stats: { spawned: 6, completed: 6, failed: 0, by_type: byType() },
    ...over,
  });

// A set of dependencies that records every call in order.
export const makeDeps = (over = {}) => {
  const calls = [];
  const record =
    (name, value) =>
    async (...args) => {
      calls.push([name, ...args]);
      return typeof value === "function" ? value(...args) : value;
    };
  const deps = {
    calls,
    config: {
      model: "sonnet",
      base: "main",
      repo: "/work/repo",
      maxTurns: 80,
      runTimeoutMs: 1_800_000,
      trustedAuthors: ["VTHoop"],
    },
    linear: { setStatus: record("linear.setStatus") },
    git: {
      addWorktree: record("git.addWorktree", () => "/work/wt/hea-1"),
      addReviewCheckout: record("git.addReviewCheckout", () => "/work/review/pr-7"),
      removeWorktree: record("git.removeWorktree"),
    },
    github: {
      findPr: record("github.findPr", () => ({ number: 7 })),
      reviewOutcome: record("github.reviewOutcome", "Approved"),
    },
    claude: record("claude", () => output()),
    ...over,
  };
  return deps;
};
