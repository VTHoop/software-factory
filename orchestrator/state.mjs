import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

// Returns a release function, or null when another invocation is still running.
export const acquireLock = (dir) => {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, String(process.pid), { flag: "wx" });
      return () => rmSync(file, { force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number.parseInt(readFileSync(file, "utf8"), 10);
      if (alive(pid)) return null;
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
