import { isTrustedPr, trustedComments } from "./access.mjs";
import { exec } from "./exec.mjs";

const GH_TIMEOUT_MS = 60_000;
const PREVIEW = /https:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.vercel\.app(?:\/[^\s)>\]]*)?/;

// The preview link a listed preview bot posted. Anyone can comment, so authors are matched exactly.
export const previewUrl = (comments, authors) =>
  comments
    .filter((c) => authors.includes(c.author?.login))
    .map((c) => c.body.match(PREVIEW)?.[0])
    .find(Boolean);

// Talks to GitHub through `gh`. Only PRs from branches in the configured repo are ever returned.
export const createGithub = (config, run = exec) => {
  // `gh api` has no -R flag; its endpoint names the repo instead.
  const gh = async (args, input) => {
    const full = args[0] === "api" ? args : ["-R", config.githubRepo, ...args];
    return (await run("gh", full, { input, env: typeof config.env === "function" ? config.env() : config.env, timeoutMs: GH_TIMEOUT_MS })).stdout;
  };
  const json = async (args) => JSON.parse(await gh(args));
  // Every page, from the REST API (see trustedComments).
  const comments = async (pr) => {
    const pages = await json(["api", "--paginate", "--slurp", `repos/${config.githubRepo}/issues/${pr}/comments?per_page=100`]);
    return trustedComments(pages.flat().map((c) => ({ author: { login: c.user?.login }, body: c.body })), config);
  };

  return {
    async findPr(branch) {
      const prs = await json([
        "pr", "list", "--head", branch, "--state", "open",
        "--json", "number,url,headRefName,isCrossRepository,headRepository",
      ]);
      return prs.find((pr) => isTrustedPr(pr, config)) ?? null;
    },

    async response(pr) {
      return (await comments(pr)).filter((c) => c.body.startsWith("## Response to /pr-review")).at(-1)?.body ?? "";
    },

    comment: (pr, body) => gh(["pr", "comment", String(pr), "--body-file", "-"], body),

    async headSha(pr) {
      return (await json(["pr", "view", String(pr), "--json", "headRefOid"])).headRefOid;
    },

    async ciState(sha) {
      const pages = await json(["api", "--paginate", "--slurp", `repos/${config.githubRepo}/commits/${sha}/check-runs?per_page=100`]);
      const runs = pages.flatMap((page) => page.check_runs);
      if (runs.length === 0) return "none";
      if (runs.some((r) => r.status !== "completed")) return "pending";
      return runs.every((r) => ["success", "neutral", "skipped"].includes(r.conclusion)) ? "success" : "failure";
    },

    async prDetails(pr) {
      // `--json comments` shows an App by its bare name, so `vercel` here is Vercel's App. Bare is safe:
      // the match is exact, `vercel` is Vercel's own account, and only a *.vercel.app link is taken.
      const data = await json(["pr", "view", String(pr), "--json", "number,url,body,comments"]);
      const preview = previewUrl(data.comments, config.previewAuthors);
      return { number: data.number, url: data.url, body: data.body, previewUrl: preview };
    },

    async prState(pr) {
      return (await json(["pr", "view", String(pr), "--json", "state"])).state;
    },
  };
};
