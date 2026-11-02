import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildArgs, buildSettings, runClaude } from "../../orchestrator/claude.mjs";

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
