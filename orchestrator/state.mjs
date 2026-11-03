import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EMPTY = { tickets: [], pausedUntil: null };

export const loadState = (dir) => {
  const file = join(dir, "state.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : structuredClone(EMPTY);
};

export const saveState = (dir, state) => {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, "state.json.tmp");
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, join(dir, "state.json"));
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

// A lock file that holds no readable PID is either half-written or damaged. It counts as held
// while it is fresh, and as stale once it is old.
const UNREADABLE_LOCK_MS = 10_000;

const holder = (file) => {
  const pid = Number.parseInt(readFileSync(file, "utf8"), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
};

// Removes the lock only while it still names this process, so it never takes another's.
export const releaseLock = (dir) => {
  const file = join(dir, "lock");
  try {
    if (holder(file) === process.pid) rmSync(file, { force: true });
  } catch {}
};

// Returns a release function, or null when another invocation is still running.
export const acquireLock = (dir) => {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, String(process.pid), { flag: "wx" });
      return () => releaseLock(dir);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const pid = holder(file);
        if (pid === null ? Date.now() - statSync(file).mtimeMs < UNREADABLE_LOCK_MS : alive(pid)) return null;
      } catch (readError) {
        if (readError.code !== "ENOENT") throw readError;
      }
      rmSync(file, { force: true });
    }
  }
  return null;
};

export const isPaused = (dir) => existsSync(join(dir, "pause"));

// A run cut off by a restart is resumed once, then escalated.
export const recover = (ticket) => {
  if (!ticket.running) return { action: "none", ticket };
  if (ticket.running.resumedOnce) return { action: "escalate", ticket };
  return { action: "resume", ticket: { ...ticket, running: { ...ticket.running, resumedOnce: true } } };
};
