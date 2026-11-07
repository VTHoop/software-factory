import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const DEFAULT_TIMEOUT_MS = 120_000;

const execFileAsync = promisify(execFile);

// execFile with a time limit, so a hung gh or git can't hold the lock forever.
export const exec = (file, args, { cwd, input, env, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const run = execFileAsync(file, args, { cwd, env, timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 32 * 1024 * 1024 });
  run.child.stdin.end(input);
  return run;
};
