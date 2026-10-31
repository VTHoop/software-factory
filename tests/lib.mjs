import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const root = join(import.meta.dirname, "..");
const pluginDir = join(root, "plugins", "software-factory");

export const SKILLS = ["address-review", "pr-review", "start-ticket"];
export const AGENTS = [
  "sdlc-review-impact",
  "sdlc-review-modernization",
  "sdlc-review-patterns",
  "sdlc-review-performance",
  "sdlc-review-quality",
  "sdlc-review-requirements",
];

export const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
export const json = (...parts) => JSON.parse(read(...parts));
export const exists = (...parts) => existsSync(join(root, ...parts));

const readOrEmpty = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");

export const skill = (name) =>
  readOrEmpty(join(pluginDir, "skills", name, "SKILL.md"));
export const agent = (name) => readOrEmpty(join(pluginDir, "agents", `${name}.md`));

export const listDir = (...parts) => {
  const dir = join(root, ...parts);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};

// Every file the plugin ships, as [relative path, contents].
export const pluginFiles = () => {
  if (!existsSync(pluginDir)) return [];
  return readdirSync(pluginDir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(md|json)$/.test(f))
    .map((f) => [f, readFileSync(join(pluginDir, f), "utf8")]);
};

// The text between `<!-- id:start -->` and `<!-- id:end -->`, or null.
export const block = (text, id) => {
  const start = text.indexOf(`<!-- ${id}:start -->`);
  const end = text.indexOf(`<!-- ${id}:end -->`);
  return start === -1 || end === -1 ? null : text.slice(start, end);
};
