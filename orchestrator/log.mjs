import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { deniedCommands } from "./checks.mjs";

export const runRecord = (output, { key, step, at, priorCostUsd = 0, claudeVersion }) => ({
  at,
  claudeVersion,
  key,
  step,
  sessionId: output.session_id,
  costUsd: (output.total_cost_usd ?? 0) - priorCostUsd,
  durationMs: output.duration_ms,
  turns: output.num_turns,
  models: output.modelUsage ?? {},
  subagents: {
    spawned: output.subagent_stats?.spawned ?? 0,
    completed: output.subagent_stats?.completed ?? 0,
    failed: output.subagent_stats?.failed ?? 0,
  },
  denied: deniedCommands(output),
});

export const appendLog = (file, record) => {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
};
