import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildArgs, buildSettings, killRunning, runClaude, settingsFile } from "../../orchestrator/claude.mjs";

const project = { extraDenials: ["Bash(supabase db push:*)"] };

describe("buildArgs", () => {
  const args = buildArgs({
    prompt: "/software-factory:pr-review 7 --unattended",
    model: "sonnet",
    maxTurns: 80,
    settings: "/tmp/settings.json",
  });

  it("runs headless with JSON output", () => {
    assert.ok(args.includes("-p"));
    assert.equal(args[args.indexOf("--output-format") + 1], "json");
  });

  it("uses auto mode and answers no permission prompts", () => {
    assert.equal(args[args.indexOf("--permission-mode") + 1], "auto");
    assert.equal(args[args.indexOf("--permission-prompts") + 1], "none");
  });

  it("passes the model and the turn limit explicitly", () => {
    assert.equal(args[args.indexOf("--model") + 1], "sonnet");
    assert.equal(args[args.indexOf("--max-turns") + 1], "80");
  });

  it("never passes --bare, which does not use subscription sign-in", () => {
    assert.ok(!args.includes("--bare"));
  });

  it("resumes a session by ID when given one", () => {
    const resumed = buildArgs({ prompt: "p", model: "sonnet", maxTurns: 1, resume: "sess-1" });
    assert.equal(resumed[resumed.indexOf("--resume") + 1], "sess-1");
    assert.ok(!args.includes("--resume"));
  });

  it("caps a run's spend when given a ceiling, and passes no cap otherwise", () => {
    const capped = buildArgs({ prompt: "p", model: "sonnet", maxTurns: 1, maxRunCostUsd: 3 });
    assert.equal(capped[capped.indexOf("--max-budget-usd") + 1], "3");
    assert.ok(!args.includes("--max-budget-usd"));
  });

  it("passes the prompt as one argument, never through a shell", () => {
    assert.ok(args.includes("/software-factory:pr-review 7 --unattended"));
  });
});

describe("buildSettings", () => {
  const { permissions } = buildSettings(project, { base: "main" });

  it("denies gh pr merge", () => {
    assert.ok(permissions.deny.includes("Bash(gh pr merge:*)"));
  });

  it("denies pushes to the base branch", () => {
    assert.ok(permissions.deny.some((d) => /git push.*main/.test(d)));
  });

  it("denies writes under .github/", () => {
    assert.ok(permissions.deny.some((d) => /^(Write|Edit)\(.*\.github/.test(d)));
  });

  const denies = (pattern) => permissions.deny.some((d) => pattern.test(d));

  it("denies merging through `gh -R <repo> pr merge`", () => {
    assert.ok(denies(/^Bash\(gh \* pr merge/));
  });

  it("denies merging through the API", () => {
    assert.ok(denies(/^Bash\(gh api .*merge/));
  });

  it("denies force pushes and + refspecs", () => {
    assert.ok(denies(/git push --force/));
    assert.ok(denies(/git push -f/));
    assert.ok(denies(/git push \* \+/));
  });

  it("denies pushing any refspec that ends in the base branch", () => {
    assert.ok(denies(/git push \* \*:main/));
    assert.ok(denies(/git push \* \*:refs\/heads\/main/));
  });

  it("denies shell writes under .github/", () => {
    assert.ok(denies(/sed -i.*\.github/));
    assert.ok(denies(/>.*\.github/));
  });

  it("denies pushing the base branch with -u, a full ref, HEAD --force, or git -C", () => {
    assert.ok(denies(/git push\* origin main\)/));
    assert.ok(denies(/git push\*refs\/heads\/main\)/));
    assert.ok(denies(/git push\*--force/));
    assert.ok(denies(/git -C \* push/));
  });

  it("denies reading the factory's secrets", () => {
    assert.ok(denies(/^Read\(.*software-factory/));
    assert.ok(denies(/secrets\.env/));
  });

  it("adds the project's extra denials", () => {
    assert.ok(permissions.deny.includes("Bash(supabase db push:*)"));
  });
});

describe("runClaude", () => {
  const node = process.execPath;

  it("parses the JSON the process prints", async () => {
    const r = await runClaude({
      bin: node,
      args: ["-e", 'console.log(JSON.stringify({session_id:"s",is_error:false}))'],
      timeoutMs: 5000,
    });
    assert.equal(r.output.session_id, "s");
    assert.equal(r.timedOut, false);
  });

  it("kills a run that exceeds its time limit and reports it", async () => {
    const started = Date.now();
    const r = await runClaude({
      bin: node,
      args: ["-e", "setTimeout(()=>{},30000)"],
      timeoutMs: 200,
    });
    assert.equal(r.timedOut, true);
    assert.ok(Date.now() - started < 5000);
  });

  it("resolves at the time limit even when a grandchild keeps the output pipes open", async () => {
    const script =
      'require("node:child_process").spawn(process.execPath,["-e","setTimeout(()=>{},15000)"],{stdio:"inherit"});setTimeout(()=>{},15000)';
    const started = Date.now();
    const r = await runClaude({ bin: node, args: ["-e", script], timeoutMs: 200 });
    assert.equal(r.timedOut, true);
    assert.ok(Date.now() - started < 5000, "waited for the grandchild");
  });

  it("reports unreadable output as an error, not a crash", async () => {
    const r = await runClaude({ bin: node, args: ["-e", "console.log('nope')"], timeoutMs: 5000 });
    assert.equal(r.output, null);
    assert.match(r.error, /JSON/i);
  });
});

describe("buildSettings for a review run", () => {
  const review = buildSettings(project, { base: "main", review: true }).permissions.deny;
  const other = buildSettings(project, { base: "main" }).permissions.deny;
  const posting = [
    "gh pr comment 7 --body-file /tmp/r.md",
    "gh -R o/r pr comment 7 --body-file x",
    "gh pr review 7 --comment -b x",
    "gh api --method POST repos/o/r/issues/7/comments --input x",
    "gh api --method POST repos/o/r/pulls/7/reviews --input x",
  ];
  const matches = (rules, command) =>
    rules.some((r) => r.startsWith("Bash(") && new RegExp(`^${r.slice(5, -1).replace(/:\*$/, "*").replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(command));

  it("denies every way of posting to the PR, because the script posts the review", () => {
    for (const command of posting) assert.ok(matches(review, command), command);
  });

  it("leaves posting allowed in other runs, where address-review replies", () => {
    assert.ok(!matches(other, "gh pr comment 7 --body-file /tmp/r.md"));
  });

  it("keeps every other denial", () => {
    for (const rule of other) assert.ok(review.includes(rule), rule);
  });
});

describe("settingsFile", () => {
  it("is different for a review run of the same repo", () => {
    assert.notEqual(settingsFile("/state", "/r/x", "review"), settingsFile("/state", "/r/x"));
  });

  it("is different for two repos that share a long path prefix", () => {
    const a = settingsFile("/state", "/Users/vthoop/dev/health-agent");
    const b = settingsFile("/state", "/Users/vthoop/dev/software-factory");
    assert.notEqual(a, b);
  });

  it("is the same for the same repo", () => {
    assert.equal(settingsFile("/state", "/r/x"), settingsFile("/state", "/r/x"));
  });
});

describe("runClaude process handling", () => {
  const node = process.execPath;

  it("killRunning ends a run in progress, as a SIGINT or SIGTERM handler would", async () => {
    const pending = runClaude({ bin: node, args: ["-e", "setTimeout(()=>{},30000)"], timeoutMs: 30_000 });
    await new Promise((r) => setTimeout(r, 300));
    const started = Date.now();
    killRunning();
    await pending;
    assert.ok(Date.now() - started < 3000, "the run was still alive");
  });

  it("keeps multi-byte characters whole when a chunk boundary falls inside one", async () => {
    const script = 'const s=JSON.stringify({result:"\u20ac".repeat(200000)});process.stdout.write(s)';
    const r = await runClaude({ bin: node, args: ["-e", script], timeoutMs: 10_000 });
    assert.equal(r.output.result.length, 200000);
    assert.ok(!r.output.result.includes("\ufffd"));
  });

  it("does not take the phrase in a successful result for a failed resume", async () => {
    const script = 'console.log(JSON.stringify({session_id:"s",is_error:false,result:"the log said: No conversation found"}))';
    const r = await runClaude({ bin: node, args: ["-e", script], timeoutMs: 5000 });
    assert.equal(r.resumeFailed, undefined);
    assert.equal(r.output.session_id, "s");
  });

  it("reports a failed resume when the CLI says no conversation was found", async () => {
    const script = 'console.error("No conversation found with session ID: x");process.exit(1)';
    const r = await runClaude({ bin: node, args: ["-e", script], timeoutMs: 5000 });
    assert.equal(r.resumeFailed, true);
  });
});

describe("buildSettings and the GitHub App", () => {
  const { permissions } = buildSettings(project, { base: "main", keyFile: "/keys/app.pem" });
  const denies = (re) => permissions.deny.some((d) => re.test(d));

  it("denies reading the App's private key file", () => {
    assert.ok(permissions.deny.includes("Read(/keys/app.pem)"));
    assert.ok(denies(/Bash\(\*\/keys\/app\.pem\*\)/));
  });

  it("denies printing the installation token from the environment", () => {
    assert.ok(denies(/GH_TOKEN/));
    assert.ok(denies(/printenv/));
  });

  it("adds no key denial when no App is configured", () => {
    const plain = buildSettings(project, { base: "main" }).permissions.deny;
    assert.ok(!plain.some((d) => d.includes("undefined")));
  });
});

describe("buildSettings against the ways around a string rule", () => {
  const { permissions } = buildSettings(project, { base: "main", keyFile: "/keys/app.pem" });
  const denies = (re) => permissions.deny.some((d) => re.test(d));

  it("denies dumping the environment, printing gh's token and reading any .pem", () => {
    assert.ok(permissions.deny.includes("Bash(env)"));
    assert.ok(denies(/^Bash\(env \*\)$/));
    assert.ok(denies(/gh auth token/));
    assert.ok(denies(/\.pem/));
    assert.ok(denies(/^Read\(\*\*\/\*\.pem\)$/));
    assert.ok(denies(/environ/));
  });
});
