import { execFile } from "node:child_process";

export const DEFAULT_TIMEOUT_MS = 120_000;

// execFile with a time limit, so a hung gh or git can't hold the lock forever.
export const exec = (file, args, { cwd, input, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { cwd, timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => (error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr })),
    );
    child.stdin.end(input);
  });
