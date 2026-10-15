# Positional arguments

Use this command reference for current main. Put the target after the command.
Confirmation asks once in a terminal unless `--yes` is set. With `--json`, `--non-interactive` or no terminal, confirmation gates preview without changes. Rejected consent uses `confirmation_required` naming `--yes`. Existing successful previews stay successful. Missing choices fail with `invalid_arguments` and name a flag.
Bare `tokate` prints help. The GUI is the other interface.

1. Show all command metadata.

   ```sh
   tokate help --json
   ```

2. Show full syntax and options for one command.

   ```sh
   tokate help work
   ```

## Command reference

`[VALUE]` is optional. Replace uppercase values with your own values.

| Command | Usage | What it does |
| --- | --- | --- |
| `work` | `tokate work ISSUE [NAME] \| RUN [options]` | Code an approved issue and verify it. Uses donor inference. Claims the issue, or prepares a fresh attempt under your active reservation. `RUN` resumes a pending claim or incomplete preparation, then codes. |
| `work` repository | `tokate work OWNER/REPO --yes [--time PER_TASK] [--total TOTAL] [options]` | Claim, work and submit approved issues until stopped. Bare `work` uses the local GitHub remote. |
| `work` stop | `tokate work OWNER/REPO stop --yes` | Wait for the current task and print the session report. |
| `claim` | `tokate claim ISSUE [NAME] [options]` | Reserve a named issue without inference or publication. Under your active reservation, prepare a fresh attempt. `OWNER/REPO` alone is invalid. |
| `claim` saved run | `tokate claim RUN [--yes]` | Finish or recheck a saved claim and its preparation without inference. |
| `submit` | `tokate submit RUN [--incomplete]` | Push saved work and request a draft PR. |
| `status` | `tokate status [--all]` | List your saved work as a table. Inside a checkout, list only that repository. Finished runs are hidden and counted. `--all` shows them. One GitHub query marks merged or closed PRs as finished. Offline, saved state is used. |
| `status` repository | `tokate status OWNER/REPO` | List approved issues with title, state, whether you act next and the next command. |
| `status` issue or run | `tokate status ISSUE \| RUN` | Show issue, state, PR and next action in a short table. `--json` adds the details, and issue data includes `coordination`. |
| `checks` | `tokate checks PR\|RUN [--watch]` | Check the receipt against owner approval, and the report, CI and freshness gates. |
| `pause` | `tokate pause RUN` | Pause your reservation. |
| `resume` | `tokate resume RUN` | Resume your paused reservation. |
| `renew` | `tokate renew RUN` | Renew before expiry. |
| `release` | `tokate release RUN` | Release your reservation. |
| `init` | `tokate init [OWNER/REPO] [options]` | Preview required Actions settings and one setup PR with the policy and `v0` workflow. Use `--pin` for an exact release commit. Ask once in a terminal or apply with `--yes`. Non-terminal preview returns `applied=false`. |
| `approve` | `tokate approve ISSUE [--base-branch BRANCH] [--yes]` | Approve an existing issue. Create issues with `gh issue create` or the GUI. |
| `revoke` | `tokate revoke ISSUE` | Revoke approval and block publication. |
| `access` | `tokate access [list\|history] [LOGIN] [OWNER/REPO]` | Inspect donor membership, requests and history. |
| `access init` | `tokate access init [OWNER/REPO]` | Initialize access authority. |
| `access trust`, `untrust`, `deny`, `restore` | `tokate access OPERATION LOGIN [OWNER/REPO]` | Change persistent donor membership. |
| `access grant`, `remove` | `tokate access OPERATION LOGIN ISSUE` | Change one issue grant. |
| `access check` | `tokate access check ISSUE` | Check your eligibility. |
| `access request` | `tokate access request ISSUE [--trust]` | Request an issue grant or persistent trust. |
| `doctor` | `tokate doctor [repo\|managed\|external\|HARNESS] [OWNER/REPO\|HARNESS] [options]` | Check prerequisites, or read repository policy and coordinator health. `--fix` explains installations and asks once in a terminal, `--fix --yes` applies them. Use `--harness-path FILE` for an existing harness. |
| `doctor claude` | `tokate doctor claude --model MODEL --effort EFFORT [--policy FILE] [--path DIR] [--file REPORT]` | Also check the Claude invocation for one owner-permitted model and effort. |
| `defaults` | `tokate defaults [list\|set\|show\|remove\|use] [NAME] [options]` | Save or select tool and model profiles. |
| `defaults check` | `tokate defaults check [OWNER/REPO] [NAME] [options]` | Check a profile or explicit choice under owner policy. |
| `update` | `tokate update [--yes]` | Show the current and latest stable version, then install it. Without a terminal, preview unless `--yes`. |
| `uninstall` | `tokate uninstall [--yes]` | Show the files to remove, then remove the managed installation and keep runs. Without a terminal, preview unless `--yes`. |
| `overlaps` | `tokate overlaps PR PR...` | Inspect filename overlap and issue dependencies. |
| `recover-request` | `tokate recover-request ISSUE` | Owner: process the latest unprocessed request with the installed coordinator. |
| `amend` | `tokate amend RUN [--time TIME] [--commit SHA] [--tools FILE] [--summary FILE] [--sync GRANT] [--resume]` | Archive completed unpublished work, resume publication or verify and publish a correction with `--time`. |
| `external` | `tokate external RUN [--commit SHA] [--summary FILE]` | Fetch and verify an exact external commit. |
| `reconcile` | `tokate reconcile RUN [--resume]` | Merge the current target into a saved published checkout. |
| `sync` authorize | `tokate sync PR authorize --commit SHA --upstream SHA [--sync PREVIOUS_GRANT]` | Owner: grant synchronization for exact commits. |
| `sync` revoke | `tokate sync PR revoke --grant SHA` | Owner: revoke a synchronization grant of the PR. |
| `completion` | `tokate completion bash\|zsh\|fish` | Print shell completion. |
| `help` | `tokate help [COMMAND]` | Show command help. |
| `--version` | `tokate --version` | Print the installed version. |
| `request` | `tokate request ISSUE --file FILE` | Post a strict claim or publication request. |
| `admit` | `tokate admit [OWNER/REPO] --event FILE` | Owner workflow: close unauthorized PRs. |
| `coordinate` | `tokate coordinate [OWNER/REPO] --event FILE` | Owner workflow: update state and publish accepted requests. |

## Issue and run names

| Form | Meaning |
| --- | --- |
| `42` | Issue 42 in the checkout's GitHub remote. `checks` uses PR 42. |
| `OWNER/REPO#42` | Issue 42 in that repository. `checks` uses PR 42. |
| `https://github.com/OWNER/REPO/issues/42` | Exact issue reference. |
| `https://github.com/OWNER/REPO/pull/10` | Exact PR reference for a PR command. |
| `OWNER/REPO` or repository URL | Repository target. `work` loops until stopped. `claim` requires a named issue. |
| `REPO#42` | Saved run for issue 42 when one saved repository has that name. |
| `42-1` | Attempt 1 for issue 42. Required only when the issue has two active attempts. |
| `OWNER/REPO#42-1` | Attempt 1 in an explicit repository. |
| `--run DIR` | Exact saved run directory. |

For a `RUN` command, bare `42` names the active saved attempt. If two attempts are active, commands that take a run refuse it. Use `42-1` to select attempt 1.

`status 42` reads issue state. `status 42-1` reads the saved attempt.
For supported time-limit failures, saved status also reads GitHub authority to
offer continuation. Other saved status reads are offline.

`checks 10` uses a saved run when that PR has exactly one saved run. Use `checks 42-1` to select an attempt explicitly.

`work 42` resumes saved work when no new selection or budget is given. A new selection or budget starts a new attempt.

## Flags and time units

| Input | Examples |
| --- | --- |
| Exact commit or authority | `--commit SHA`, `--upstream SHA`, `--grant SHA` |
| File input or output | `--tools FILE`, `--summary FILE`, `--file FILE`, `--event FILE` |
| Execution selection | `--harness codex`, `--model MODEL`, `--effort high`, `--provider openai` |
| Time with a required unit | `--time 30m`, `--total 8h`, `--verify-time 10m`, `--max-time 2h`, `--reservation-time 1d`, `--timeout 45s` |
| Units | `s` seconds, `m` minutes, `h` hours, `d` days |

See [owners](owners.md), [donors](donors.md) and [recovery](recovery.md).

## If something fails

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `No saved runs.` | `tokate status OWNER/REPO#42` |
| `The saved run or command state does not permit this operation. Inspect its artifacts.` | `tokate status --run DIR --json` |
