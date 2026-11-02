const REVIEWERS = ["impact", "modernization", "patterns", "performance", "quality", "requirements"];

export const signedIn = (statusJson) => {
  try {
    if (JSON.parse(statusJson).loggedIn === true) return { ok: true };
  } catch {}
  return {
    ok: false,
    message: "Claude Code is signed out. Run `claude auth login` as the user that runs this script, then start it again.",
  };
};

const resultLine = (text) => {
  const lines = String(text ?? "").split("\n").filter((l) => l.startsWith("SOFTWARE_FACTORY_RESULT: "));
  const last = lines.at(-1);
  if (!last) return null;
  try {
    return JSON.parse(last.slice("SOFTWARE_FACTORY_RESULT: ".length));
  } catch {
    return null;
  }
};

const deniedCommands = (output) =>
  (output.permission_denials ?? []).map(
    (d) => d.tool_input?.command ?? d.tool_input?.file_path ?? d.tool_name,
  );

const reviewersMissing = (output) => {
  const byType = output.subagent_stats?.by_type ?? {};
  return REVIEWERS.filter((name) => {
    const entry = Object.entries(byType).find(([type]) => type.endsWith(`sdlc-review-${name}`))?.[1];
    return !(entry && entry.spawned >= 1 && entry.completed >= 1);
  });
};

// Whether a finished run counts. `expect: "review"` also requires all six reviewers.
export const judgeRun = (output, { maxTurns, expect }) => {
  if (output.is_error) {
    return {
      ok: false,
      kind: "error",
      reason: `The run ended in an error (${output.terminal_reason ?? "unknown"}): ${String(output.result ?? "").slice(0, 300)}`,
      retrySameSession: false,
    };
  }
  const denied = deniedCommands(output);
  if (denied.length > 0) {
    return { ok: false, kind: "denied", denied, reason: `Permission denied for: ${denied.join("; ")}` };
  }
  if (output.num_turns > maxTurns) {
    return {
      ok: false,
      kind: "turn-limit",
      resumable: false,
      reason: `The run used ${output.num_turns} turns; the limit is ${maxTurns}.`,
    };
  }
  const result = resultLine(output.result);
  if (!result) return { ok: false, kind: "no-result", reason: "The run ended without a SOFTWARE_FACTORY_RESULT line." };
  if (result.status === "stopped") {
    return { ok: false, kind: "stopped", reason: `The skill stopped: ${result.reason}` };
  }
  if (expect === "review") {
    const missing = reviewersMissing(output);
    if (missing.length > 0) {
      return {
        ok: false,
        kind: "reviewers",
        reason: `Only ${REVIEWERS.length - missing.length} of ${REVIEWERS.length} reviewers started and finished; missing: ${missing.map((m) => `sdlc-review-${m}`).join(", ")}.`,
      };
    }
  }
  return { ok: true };
};

// A plan-limit result carries when the limit resets, as `...limit reached|<epoch seconds>`.
export const parseLimit = (output, { now, fallbackMs = 3_600_000 }) => {
  const text = String(output.result ?? "");
  if (!/usage limit reached/i.test(text)) return null;
  const epoch = text.match(/\|(\d{9,})/);
  const resetAt = epoch ? new Date(Number(epoch[1]) * 1000) : new Date(now.getTime() + fallbackMs);
  return { resetAt };
};
