export const REVIEWERS = ["impact", "modernization", "patterns", "performance", "quality", "requirements"];

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

const MAX_COMMAND = 200;

// Denied commands are model-written and end up in comments, notifications and the log.
export const redact = (text) => {
  const masked = String(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/lin_api_\w+/g, "[redacted]")
    .replace(/sk-ant-[\w-]+/g, "[redacted]")
    .replace(/gh[pousr]_\w+/g, "[redacted]")
    .replace(/(\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\w*=)\S+/g, "$1[redacted]");
  return masked.length > MAX_COMMAND ? `${masked.slice(0, MAX_COMMAND)}…` : masked;
};

export const deniedCommands = (output) =>
  (output.permission_denials ?? []).map((d) =>
    redact(d.tool_input?.command ?? d.tool_input?.file_path ?? d.tool_name),
  );

// `by_type` only counts spawns per agent type; finishing is known from the totals beside it.
const reviewersMissing = (output) => {
  const stats = output.subagent_stats ?? {};
  const byType = stats.by_type ?? {};
  const allFinished = (stats.failed ?? 0) === 0 && (stats.completed ?? 0) >= (stats.spawned ?? 0);
  return REVIEWERS.filter((name) => {
    const spawned = Object.entries(byType).find(([type]) => type.endsWith(`sdlc-review-${name}`))?.[1];
    return !(spawned >= 1 && allFinished);
  });
};

// Whether a finished run counts. `expect: "review"` also requires all six reviewers.
export const judgeRun = (output, { maxTurns, expect }) => {
  if (output.is_error) {
    return {
      ok: false,
      kind: "error",
      reason: `The run ended in an error (${output.terminal_reason ?? "unknown"}): ${String(output.result ?? "").slice(0, 300)}`,
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
