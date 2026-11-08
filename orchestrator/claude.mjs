import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const buildArgs = ({ prompt, model, maxTurns, maxRunCostUsd, resume, settings }) => [
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
  // Turns count only the parent session; a review's spend is in its subagents, so only a budget bounds it.
  ...(maxRunCostUsd ? ["--max-budget-usd", String(maxRunCostUsd)] : []),
  ...(settings ? ["--settings", settings] : []),
  ...(resume ? ["--resume", resume] : []),
  prompt,
];

// A review run posts nothing: the script posts the file it writes, so one round is one comment.
// The leading `*` also catches a command behind `cd x &&` or an env prefix. This is a guardrail,
// not enforcement: the run's token can still write.
const POSTING = [
  "Bash(*gh pr comment*)",
  "Bash(*gh * pr comment*)",
  "Bash(*gh issue comment*)",
  "Bash(*gh * issue comment*)",
  "Bash(*gh pr review*)",
  "Bash(*gh * pr review*)",
  "Bash(*gh pr edit*)",
  "Bash(*gh * pr edit*)",
  "Bash(*gh issue edit*)",
  "Bash(*gh * issue edit*)",
  // `gh api` writes with a method or a body, and posts whenever it has one. Reads stay allowed:
  // pr-review reads earlier reviews from the comments endpoint.
  "Bash(*gh api *-X*)",
  "Bash(*gh api *--method*)",
  "Bash(*gh api *-f *)",
  "Bash(*gh api *-F *)",
  "Bash(*gh api *--field*)",
  "Bash(*gh api *--raw-field*)",
  "Bash(*gh api *--input*)",
  "Bash(*gh api graphql*)",
];

export const buildSettings = (project, { base, keyFile, review }) => ({
  permissions: {
    deny: [
      "Bash(gh pr merge:*)",
      "Bash(gh * pr merge*)",
      "Bash(gh api *merge*)",
      `Bash(git push origin ${base}:*)`,
      `Bash(git push* origin ${base})`,
      `Bash(git push*refs/heads/${base})`,
      "Bash(git push*--force*)",
      "Bash(git -C * push*)",
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
      "Read(~/.config/software-factory/**)",
      "Bash(*secrets.env*)",
      "Bash(*GH_TOKEN*)",
      "Bash(printenv*)",
      "Bash(env)",
      "Bash(env *)",
      "Bash(gh auth token*)",
      "Bash(*.pem*)",
      "Bash(*environ*)",
      "Read(**/*.pem)",
      ...(keyFile ? [`Read(${keyFile})`, `Bash(*${keyFile}*)`] : []),
      "Write(.github/**)",
      "Edit(.github/**)",
      ...(project.extraDenials ?? []),
      ...(review ? POSTING : []),
    ],
  },
});

// One settings file per repo, named from a hash of the whole path, and one more for its review runs.
export const settingsFile = (stateDir, repo, step) =>
  join(stateDir, `settings-${createHash("sha256").update(repo).digest("hex").slice(0, 16)}${step === "review" ? "-review" : ""}.json`);

const GRACE_MS = 2000;
const live = new Set();

// Kills every run in progress. A SIGINT or SIGTERM handler calls it, because Node
// does not emit `exit` for an unhandled signal and the detached runs would live on.
export const killRunning = () => {
  for (const kill of live) kill();
};

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
    let grace;
    live.add(killGroup);
    process.once("exit", killGroup);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
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
      clearTimeout(grace);
      live.delete(killGroup);
      process.removeListener("exit", killGroup);
      killGroup();
      if (timedOut) return resolve({ output: null, timedOut: true });
      let output = null;
      try {
        output = JSON.parse(stdout);
      } catch {}
      // The phrase only means a failed resume in an error: not in a run's own successful result.
      const failedResume = output ? output.is_error && /no conversation found/i.test(output.result ?? "") : /no conversation found/i.test(stderr + stdout);
      if (failedResume) return resolve({ output: null, timedOut: false, resumeFailed: true });
      if (output) return resolve({ output, timedOut: false });
      resolve({
        output: null,
        timedOut: false,
        error: error ?? `The run did not print JSON. stderr: ${stderr.slice(0, 300)}`,
      });
    }
    child.on("error", (e) => finish(e.message));
    child.on("exit", () => {
      grace = setTimeout(() => finish(), GRACE_MS);
    });
    child.on("close", () => finish());
  });
