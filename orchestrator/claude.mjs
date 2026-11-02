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
      "Bash(gh * pr merge*)",
      "Bash(gh api *merge*)",
      `Bash(git push origin ${base}:*)`,
      `Bash(git push origin HEAD:${base}:*)`,
      `Bash(git push origin HEAD:refs/heads/${base}:*)`,
      "Bash(git push --force*)",
      "Bash(git push -f*)",
      "Bash(git push * +*)",
      `Bash(git push * *:${base})`,
      `Bash(git push * *:refs/heads/${base})`,
      "Bash(sed -i*.github/*)",
      "Bash(tee*.github/*)",
      "Bash(*> .github/*)",
      "Bash(*>> .github/*)",
      "Write(.github/**)",
      "Edit(.github/**)",
      ...(project.extraDenials ?? []),
    ],
  },
});

const GRACE_MS = 2000;

// Runs the CLI in its own process group and resolves with its parsed JSON. It never
// rejects: a run that times out, prints no JSON or can't find its session is reported
// in the result. A grandchild holding the output pipes can't keep it waiting.
export const runClaude = ({ bin = "claude", args, cwd, timeoutMs, env = process.env }) =>
  new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let done = false;
    const killGroup = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    process.once("exit", killGroup);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
      finish();
    }, timeoutMs);
    function finish(error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.removeListener("exit", killGroup);
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
    }
    child.on("error", (e) => finish(e.message));
    child.on("exit", () => setTimeout(() => finish(), GRACE_MS));
    child.on("close", () => finish());
  });
