import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The key a repo's .mcp.json uses for Linear, read from the named environment variable.
export const linearKeyFor = (repo, env = process.env) => {
  const mcp = JSON.parse(readFileSync(join(repo, ".mcp.json"), "utf8"));
  const server = Object.values(mcp.mcpServers ?? {}).find((s) => /linear/i.test(s.url ?? ""));
  const name = server?.headers?.Authorization?.match(/\$\{(\w+)\}/)?.[1];
  if (!name) throw new Error(`${repo}/.mcp.json has no Linear server whose Authorization names an env var`);
  if (!env[name]) throw new Error(`${name} is not set; ${repo}/.mcp.json uses it for Linear`);
  return env[name];
};

const required = (config, key) => {
  if (config[key] === undefined) throw new Error(`config: ${key} is required`);
};

export const loadConfig = (file) => {
  const config = JSON.parse(readFileSync(file, "utf8"));
  for (const key of ["model", "maxTurns", "runTimeoutMs"]) required(config, key);
  if (!Array.isArray(config.entries) || config.entries.length === 0) throw new Error("config: entries is required");
  config.entries.forEach((entry, i) => {
    if (!entry.repo) throw new Error(`config: entries[${i}].repo is required`);
    if (!Array.isArray(entry.projects) || entry.projects.length === 0) {
      throw new Error(`config: entries[${i}].projects must name at least one Linear project`);
    }
  });
  return {
    base: "main",
    ciTimeoutMs: 900_000,
    ciIntervalMs: 30_000,
    trustedAuthors: [],
    ...config,
  };
};

export const projectFor = (config, project) =>
  config.entries.find((entry) => entry.projects.includes(project)) ?? null;

export const defaultPaths = (env = process.env) => {
  const home = env.HOME;
  const state = join(home, ".local", "state", "software-factory");
  return {
    config: join(home, ".config", "software-factory", "config.json"),
    secrets: join(home, ".config", "software-factory", "secrets.env"),
    state,
    log: join(state, "runs.jsonl"),
    worktrees: join(state, "worktrees"),
  };
};

export const configExists = (file) => existsSync(file);
