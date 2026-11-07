# The orchestrator

A script that takes a **Ready** Linear ticket to a reviewed, addressed pull request. Each run of it is one poll: it does whatever step is due, then exits. It uses no model until a step needs one, so an idle poll costs no Claude usage.

For a ticket it:

1. moves the issue to **In Progress**, then runs `/software-factory:start-ticket <key> --unattended` in a new worktree;
2. runs `/software-factory:pr-review <n> --unattended` in a new session and its own checkout, and counts the review only if all six `sdlc-review-*` agents started and finished. The run is denied every way of posting to the PR; it writes its comment to `.software-factory/review.md`, and the script posts that file once;
3. resumes the implementer session with `/software-factory:address-review <n> --unattended` (a fresh session if it can’t be resumed) after the first review whatever its outcome, because an Approved review can still carry findings. A review that was not Approved gets one more review, at most two reviews in all; an Approved one goes straight to the handoff;
4. waits for CI on the head commit and sends a handoff notification, then moves the issue to **In Review**.

A failed run, a skill that stopped, any permission denial, a second review that still isn't Approved, or a time or turn limit is an escalation: a comment on the issue and the PR, the `needs-owner` label, a move back to Todo if there is no PR yet, and a notification. Hitting a plan limit is a pause, not an escalation.

## Setup

The script needs Node.js 24, the version CI runs; `util.parseEnv` alone needs 20.12. Everything else it needs lives outside this repo.

| File | Holds |
| --- | --- |
| `~/.config/software-factory/config.json` | The settings below. |
| `~/.config/software-factory/secrets.env` | `PUSHOVER_USER_KEY` and `PUSHOVER_APP_TOKEN`, one `NAME=value` per line. Mode 600. |
| `~/.local/state/software-factory/` | `state.json`, `runs.jsonl`, the lock and pause files, the worktrees, and one `settings-<hash>.json` per repo (the deny rules each run is started with; the script rewrites them before every run). |

```json
{
  "model": "sonnet",
  "maxTurns": 80,
  "runTimeoutMs": 1800000,
  "base": "main",
  "ciTimeoutMs": 900000,
  "trustedAuthors": ["VTHoop"],
  "githubApp": {
    "appId": "123456",
    "installationId": "78901234",
    "privateKeyFile": "/Users/factory/.config/software-factory/github-app.pem",
    "botLogin": "your-factory[bot]",
    "botUserId": 123456789
  },
  "entries": [
    {
      "repo": "/Users/you/dev/health-agent",
      "githubRepo": "VTHoop/disciplined-sidekick",
      "team": "Health Agent",
      "extraDenials": ["Bash(supabase db push:*)"]
    }
  ]
}
```

`model` is passed to every step. `trustedAuthors` and the `githubApp` bot are the only GitHub logins whose review comments count; a fork PR or a stranger's comment starts nothing. `githubApp` is the identity the script acts as on GitHub; see *The GitHub App*. `maxTurns` and `runTimeoutMs` limit each run; hitting either escalates the ticket. Optional settings:

| Setting | Default | Meaning |
| --- | --- | --- |
| `base` | `main` | The branch worktrees start from. |
| `ciTimeoutMs` | 900000 | How long the handoff waits for CI on the head commit. |
| `ciIntervalMs` | 30000 | How often it checks CI while it waits. |
| `maxRunCostUsd` | none | A spend ceiling for each run, in USD. `maxTurns` cannot bound a review, because its cost is in the six reviewer subagents, not in the parent's turns. A run that reaches it stops with an error and the ticket escalates. `node orchestrator/report.mjs` shows what each ticket cost. |
| `previewAuthors` | `["vercel"]` | The only GitHub logins whose preview links the handoff uses. |

Set `SOFTWARE_FACTORY_CONFIG` to read the config from another path. The exit code is 0 when the poll ran, whether or not it acted, and 1 when it failed, such as when Claude is signed out.

The deny rules in each run's settings are guardrails, not enforcement: they match command text, and a determined model or an unusual spelling can get past them. Turn on branch protection for the base branch on GitHub, so a push or merge to it is refused whatever a run does.

The plugin must be installed at user level (see the main README, *Headless runs*), and `claude auth login` done as the user that runs the script. The environment that starts the script needs `PATH` to reach `gh`, `node`, `pnpm` and Docker, and the variable each repo's `.mcp.json` names for Linear (for Disciplined Sidekick, `LINEAR_HEA_API_KEY`). Never pass `--bare`: it doesn't use subscription sign-in.

## Run it

```bash
node orchestrator/cli.mjs
```

Or poll every few minutes:

```bash
while true; do node orchestrator/cli.mjs; sleep 300; done
```

An invocation that starts while another is running exits without acting. Stop the project's local services, such as Supabase (`supabase stop`), before you start it on your own machine: runs start them and clash with yours on the same ports.

## Linear labels

Every Linear workspace the script works in needs a label named `needs-owner`, as a team or workspace label. An escalation adds it first, so without it the escalation fails with `No label named needs-owner`. When an escalation itself fails, the ticket stays `failed` with its original reason, the poll exits with code 1 and says why, and the next poll tries the escalation again. Create the label and the next poll finishes the escalation. Only a ticket in **Ready** without `needs-owner` is picked up, so to run an escalated ticket again, remove the label and move it back to Ready.

## Add a project

Add an entry to `entries` in `config.json` with the repo's local path, its GitHub `owner/name` and its Linear team name. One repo to one team is the normal case, and that is all an entry needs. Its `AGENTS.md` needs a `## Verification` section. Put the project's own deny rules in `extraDenials`. Set `needsDocker: true` on an entry whose runs need Docker, such as ones that start Supabase: a poll then fails before it touches a ticket while `docker info` fails, which is how the daemon looks for a while after a reboot, and the next poll tries again.

The GitHub App must be installed on the repo, so it can push branches and its reviews count. See *The GitHub App* for the steps, including the rule on the base branch.

If a team's tickets span repos, give each of that team's entries a `projects` list. An entry that lists an issue's project takes it; the script refuses a config where two entries share a team and one has no `projects`. Tickets are picked from **Ready**, highest priority and then oldest first; one with `needs-owner` or an open blocker is skipped.

## The GitHub App

The script acts on GitHub as a GitHub App, not as a second user account: GitHub suspended a separate account on a public repo, and an App gets narrower, shorter-lived access.

**Register it** (once, as the owner, under *Settings → Developer settings → GitHub Apps*). Give it only these repository permissions: contents (read and write), pull requests (read and write), issues (read and write) and checks (read). No admin, no workflows, no webhook. Choose *Only on this account*, generate a private key, and note the App ID, the bot's login (`<slug>[bot]`) and its user ID (`gh api /users/<slug>%5Bbot%5D --jq .id`).

**Install it on a new repo** (*Install App*, then *Only select repositories*) for exactly the repos in `entries`. The installation ID is in the URL of its settings page. Add the repo's `entries` item and the `githubApp` block above to the config.

**Put the key on the machine** outside the repo (and every other configured repo), mode 600, owned by the user that runs the script, and point `privateKeyFile` at it:

```bash
install -m 600 github-app.pem ~/.config/software-factory/github-app.pem
```

A poll refuses to start while the key is readable by group or others, or sits inside a configured repo.

**Add a rule on the base branch** of each public repo the App is installed on (*Settings → Rules → Rulesets*, target the default branch, restrict updates and require a pull request, with no bypass for the App). Then prove it from the machine: a test push as the App to `main` must be rejected.

**Every poll** mints a fresh installation token for only the configured repos, before it touches GitHub, and gives it to `gh`, `git` and the runs (`GH_TOKEN`, with git reading it through `gh auth git-credential`, so it is never in a remote URL). A run starts only on a token minted within the last 30 minutes, and `runTimeoutMs` may be at most 30 minutes while `githubApp` is set, so a run ends before its token (an hour) does. Other `gh` and `git` calls in the poll, such as cleanup, keep working until 55 minutes after the mint. A poll that can't mint one logs why to `runs.jsonl` (`"event":"identity-failed"`), exits with code 1 and starts nothing. Commits, PRs and comments show as `<slug>[bot]` with the App's noreply email.

**Revoke or rotate the key:** on the App's settings page, generate a new key, replace the file, then delete the old key there. Deleting a key revokes it at once. To cut the App off entirely, suspend or uninstall it. The key never appears in logs, PRs or Linear. The run settings also deny reading the key file and printing the token (`env`, `gh auth token`, any `.pem`), but those are guardrails: they match command text, and the runs share the key's owner. Where that matters, run the script as a separate macOS user from the one you sign in as, and treat the key as reachable by anything a run can do.

## Follow a run

`runs.jsonl` gets a line per finished run with its estimated usage, duration, turns, subagent counts and `claudeVersion`, the Claude Code version the run used. A timed-out run writes no line: the ticket's escalation says so instead.

```bash
tail -f ~/.local/state/software-factory/runs.jsonl
```

`state.json` holds each ticket's phase, PR and session ID. The PR and the Linear issue show the rest.

The handoff message reads the `## Response to /pr-review` table that address-review posts: the column order (`#`, finding, severity, disposition, evidence) and the `Dismissed` and `Deferred` prefixes on the disposition column. A changed table layout would leave the dismissals and deferrals out of the message.

### Follow a live run

From another machine, over SSH, tail the log. A line appears when a run ends, not while it works.

```bash
ssh <agent-user>@<mini> tail -f ~/.local/state/software-factory/runs.jsonl
```

The PR and the Linear issue show progress in between.

## Open a run with `claude --resume`

Take the ticket's `sessionId` from `state.json` and resume it from any directory:

```bash
claude --resume <sessionId>
```

## Pause

Create the pause file to stop new work. A run in progress carries on, and so does a ticket that holds the slot.

```bash
touch ~/.local/state/software-factory/pause
```

Delete it to carry on. Emptying `entries` in the config does the same. After a plan limit the script pauses itself until the limit resets and tells you when.

## Development

```bash
node --test
```
