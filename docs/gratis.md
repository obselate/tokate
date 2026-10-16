# Donate gratis

Gratis mode donates work to a public GitHub repository that has no `.github/tokate.json`.
No owner approves the task. You consent once at the start. Tokate then runs your harness,
commits as you, pushes to your fork and opens a draft PR.

Session reports derive task counts, token usage and time from saved runs. `wall_seconds` sums saved task time and excludes idle time. Keep the session runs to report their results.

## Commands

```sh
# Let the harness choose tasks for one hour
tokate work OWNER/REPO --harness HARNESS --model MODEL --effort EFFORT --time 1h --total 1h --yes
tokate work OWNER/REPO stop

# Work one issue, then publish
tokate work OWNER/REPO#42 --harness HARNESS --model MODEL --effort EFFORT --time 1h --yes

# Work each listed issue in this order
tokate work OWNER/REPO#12,15,40 --harness HARNESS --model MODEL --effort EFFORT --time 1h --yes

# Stop each task before publication, read the exact PR text, then publish
tokate work OWNER/REPO#42 --harness HARNESS --model MODEL --effort EFFORT --time 1h --review --yes
tokate submit OWNER/REPO#42 --json
tokate submit OWNER/REPO#42 --yes

# Give the harness repository hints
tokate work OWNER/REPO#42 --harness HARNESS --model MODEL --effort EFFORT --time 1h --prompt hints.md --yes
```

Pi also needs `--endpoint http://127.0.0.1:PORT/v1` or a saved profile. See [local inference with Pi](donors.md#local-inference-with-pi).

## How it works

| Step | Behavior |
| --- | --- |
| Guidance | Tokate puts root and nested `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md` and `CONTRIBUTING` files into the prompt in full. Docs they link to are listed by path. |
| Selection | Without an issue, the harness chooses one task that no open PR covers. With issues, Tokate checks that each is open, unlocked and not a PR before consent. |
| Refusal | If the guidance forbids AI work or requires approval first, the harness writes `tokate-refusal.txt` and the session stops. |
| Title | If the guidance sets a title format, the harness writes `tokate-title.txt`. Tokate uses it for the commit subject and PR title. Otherwise it uses the issue title. |
| Publication | Draft PR from your fork with maintainer edits allowed. It is a ready PR only when the guidance allows it and the harness writes `tokate-ready.txt`. |
| PR body | `Fixes #N`, the harness summary, the donor-reported checks, an attribution line and a hidden receipt. Tokate itself runs no repository checks. |
| Stop | Free selection stops on refusal, no PR, the total budget, a stop request or three consecutive failures. A list stops after its last issue or on the same conditions. |

## Check first

| Check | How | If it fails |
| --- | --- | --- |
| Account | `gh api user --jq .login` | Log in with `gh auth login` as the donor. |
| No Tokate policy | `gh api repos/OWNER/REPO/contents/.github/tokate.json` returns 404 | The repository uses the approved flow. See the [donor guide](donors.md). |
| AI contributions allowed | Read `AGENTS.md`, `CONTRIBUTING.md` and the README contributing section in full | Do not donate. |
| Issue is free | `gh issue view N -R OWNER/REPO --comments` shows it open, unassigned and not claimed in comments | Pick another issue. |
| No fix in progress | `gh pr list -R OWNER/REPO --state open --search "N in:body"` is empty, and the owner has not said they are fixing it | Pick another issue. Tokate does not check open PRs for issues you name. |
| Toolchain | The version that the repository pins, for example `go.mod`, `rust-toolchain.toml` or `.nvmrc` | Name the version in `--prompt`. |
| Title format | CI workflows that check PR titles, for example semantic PR title actions | Name the format in `--prompt` if the guidance does not state it. |
| Budget | Harness, model, effort, `--time` per task and `--total` | Agree on them with the donor before inference. |

## Agent template

Give this to the AI agent that runs Tokate for you. Replace the values in capitals.

````text
You run a Tokate gratis donation for me on GitHub. Use only my account and the
budget below. Do not start inference before every check passes and I confirm.

Repository: OWNER/REPO
Issues: N1,N2 (or "harness chooses")
Harness: HARNESS  Model: MODEL  Effort: EFFORT
Time per task: 1h  Total: 2h
Review before publication: yes or no

Before inference:
1. Run `gh api user --jq .login` and confirm it is my login.
2. Confirm `.github/tokate.json` does not exist in the repository.
3. Read AGENTS.md, CONTRIBUTING.md, nested AGENTS.md files and the README
   contributing section in full. If they forbid AI contributions or require
   approval before work, stop and tell me.
4. For each issue: confirm it is open, unlocked, unassigned, not claimed in
   comments, and that no open PR fixes it. Drop issues that fail. Tell me why.
5. Find the toolchain version the repository pins and the PR title format its
   CI enforces. Write both into hints.md with any other rule from the guidance
   that the harness may miss.
6. Run the preview without --yes and show me the consent text:
   tokate work OWNER/REPO#N1,N2 --harness HARNESS --model MODEL --effort EFFORT --time 1h --prompt hints.md
7. Wait for my confirmation, then run the same command with --yes
   (and --review if I asked for review).

After the run:
8. Read the donation report. For each task, read the diff in the run checkout
   (`tokate status` lists runs and their paths).
9. With --review, show me `tokate submit OWNER/REPO#N --json` output and publish
   with --yes only after I approve the exact text.
10. Check each PR: title check, bot comments, CI. If the guidance says to open
    drafts and mark them ready after CI passes, mark ready only when every
    workflow run on the current head succeeded.
11. Report PR links, CI state and anything that needs me.

Never retry, switch models or start another run on your own. Never force push.
Never post comments in the repository unless I approve the exact text.
````

## Problems and fixes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Gratis work requires an open, unlocked issue, not a pull request: #N` | The issue is closed, locked or is a PR | Check it with `gh api repos/OWNER/REPO/issues/N`. Pick another issue. |
| `Guidance and PR snapshot exceed 64 KiB` | Tokate older than 0.6.3 copied linked docs into the prompt | Run `tokate update`. |
| CI runs show `action_required` | The repository requires maintainer approval for first-time contributors | Wait for a maintainer. Do not push again to start CI. |
| The PR title check fails | The harness did not follow the title format | Fix it with `gh pr edit N -R OWNER/REPO --title "TITLE"`. Add the format to `--prompt` next time. |
| A repository bot says maintainers cannot edit the PR | Tokate older than 0.6.5 turned maintainer edits off | `gh api -X PATCH repos/OWNER/REPO/pulls/N -F maintainer_can_modify=true`, then run `tokate update`. |
| Lint or tests fail only on your machine | Your toolchain is newer than the pinned one | Name the pinned version in `--prompt`, for example `GOTOOLCHAIN=go1.25.9`. |
| The session stops with `no_pr` | The harness found no task that no open PR covers | Read the report. Name issues instead. |
| The session stops with `refused` | The guidance forbids AI work or requires approval | Respect it. Do not donate to this repository. |
| `--time 1h --total 1h` runs no task | Tokate older than 0.6.4 | Run `tokate update`. |
| `tokate status OWNER/REPO#N` shows `approval_waiting` | Known defect: status applies the approved flow to gratis issues | Ignore it. Use `tokate status` for saved gratis runs. |
| A maintainer asks for changes | Revisions through Tokate are not available yet | Commit in the run checkout and push to the fork branch from the PR. Add commits. Do not force push. |
| The harness summary contains debugging history | Tokate older than 0.6.5 | Run `tokate update`. Edit the PR body with `gh pr edit` if needed. |
