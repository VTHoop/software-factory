import { spawn } from "node:child_process";

export const buildArgs = ({ prompt, model, maxTurns, resume, settings }) => [
  "-p",
  "--output-format",
  "json",
  "--model",
  model,
  "--permission-mode",
  "auto",
  "--permission-prompts",
  "none",
  "--max-turns",
  String(maxTurns),
  ...(settings ? ["--settings", settings] : []),
  ...(resume ? ["--resume", resume] : []),
  prompt,
];

export const buildSettings = (project, { base }) => ({
  permissions: {
    deny: [
      "Bash(gh pr merge:*)",
      `Bash(git push origin ${base}:*)`,
      `Bash(git push origin HEAD:${base}:*)`,
      `Bash(git push origin HEAD:refs/heads/${base}:*)`,
      "Write(.github/**)",
      "Edit(.github/**)",
      ...(project.extraDenials ?? []),
    ],
  },
});

// Runs the CLI and resolves with its parsed JSON. It never rejects: a run that
// times out, prints no JSON or can't find its session is reported in the result.
export const runClaude = ({ bin = "claude", args, cwd, timeoutMs, env = process.env }) =>
  new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const finish = (error) => {
      clearTimeout(timer);
      if (timedOut) return resolve({ output: null, timedOut: true });
      if (/no conversation found/i.test(stderr + stdout)) {
        return resolve({ output: null, timedOut: false, resumeFailed: true });
      }
      try {
        resolve({ output: JSON.parse(stdout), timedOut: false });
      } catch {
        resolve({
          output: null,
          timedOut: false,
          error: error ?? `The run did not print JSON. stderr: ${stderr.slice(0, 300)}`,
        });
      }
    };
    child.on("error", (e) => finish(e.message));
    child.on("close", () => finish());
  });
