# Accept donations

Set up a repository for current main. Approve tasks, then review donated work before merge.

Check an existing repository with `tokate doctor repo OWNER/REPO` or add `--json` for structured results.
It shows the policy and reads the coordinator pin, Actions settings, access record,
approvals and last Tokate workflow run. Each problem names a fix command or setting.
It changes nothing. Exit 0 means the read succeeded, even when problems are found.

## Set up once

1. Install Tokate on Linux x86_64 with glibc 2.34+ or Alpine 3.24.

   ```sh
   curl -qfsSL https://tokate.dev/install.sh | sh
   ```

2. Sign in to GitHub.

   ```sh
   gh auth login
   ```

3. Preview the setup. No checkout is necessary.

   ```sh
   tokate init OWNER/REPO
   ```

   Defaults: the default branch as target, `trusted` access, and codex, claude and pi with any model.
   Verification commands and required checks are optional and default to none.
   Use `--verification JSON` for JSON argv arrays and `--required-checks JSON` for CI check names.
   Use `--eligibility open`, `--base-branch BRANCH`, `--max-time TIME`,
   `--reservation-time TIME` and `--allowed-tools JSON` to change choices.
   Existing policy values are kept unless a flag changes them. Omitted optional fields stay omitted.
   Set `"maintainer_edits": false` in the policy to prevent maintainer edits. The default is true.
   The donor creates the draft PR with this setting. The coordinator verifies and records the PR.

   Init checks GitHub authentication and write access. Before a change, it lists:

   | Item | Change |
   | --- | --- |
   | Actions workflow permissions | Allow GitHub Actions to create and approve pull requests. Default permissions stay. |
   | Actions allowlist | Add the shared workflow only when the current allowlist blocks it and has no explicit deny. Other entries stay. |
   | `tokate-setup` | Create or advance a branch with `.github/tokate.json` and `.github/workflows/tokate-coordinator.yml`. |
   | Setup PR | Open a PR from `tokate-setup` into the default branch, or reuse the open one. |

   Init never writes branch protection or creates the access record. It does not create
   an event policy when no policy restricts the coordinator. Doctor keeps settings diagnosis read-only.

   Each setting shows its current and proposed value. Steps that init cannot apply
   are printed as `Manual:` and listed in `data.manual`. Init asks once in a terminal.
   With `--json`, `--non-interactive` or no terminal and no `--yes`, it changes nothing
   and exits 0 with `applied=false`.

4. Apply the setup. Init opens the setup PR.

   ```sh
   tokate init OWNER/REPO --yes
   ```

5. Review and merge the setup PR before task approval.

   ```sh
   gh pr merge tokate-setup
   ```

| Requirement | Check |
| --- | --- |
| Public GitHub repository | Repository visibility is public. |
| GitHub CLI and repository admin rights | `tokate init` checks them. |
| Actions is enabled | `gh api repos/OWNER/REPO/actions/permissions` |
| No tracked build output | Keep generated build files out of Git. |

Init stops when Actions is disabled or an event policy blocks Tokate events. When
`local_only` or a blocking exclusion prevents the pinned workflow, init prints the
manual setting. Fix it before donors submit requests.

| Who can contribute? | Access |
| --- | --- |
| `trusted` | Trusted donors or donors named in the issue approval with `approve ISSUE LOGIN`. |
| `open` | Authenticated GitHub users who are not denied. |

Denial blocks every donor, including trusted donors and donors named in an approval.
An absent `tokate/access` ref is an empty record. The first access write creates it.

Owners do not need a coding tool or an AI subscription. Keep fork CI read-only and without secrets.

## Model permissions

Setup writes policy version 3. Each `allowed_tools` entry may contain a `models`
map from exact model names to effort arrays. Omit `models` to allow any model for
that harness/provider pair. Version 3 has no top-level `models` or `model_policy`.

```json
{"harness": "claude", "provider": "anthropic", "models": {"claude-sonnet-5-5": ["high"]}}
```

Pass the complete tool array with `--allowed-tools JSON` to edit per-tool models.

To allow a harness that Tokate does not ship, declare a `command` tool. Tokate runs
the argv without a shell or a sandbox. It sends the prompt on standard input.

```json
{"harness": "command", "provider": "openrouter", "output": "session",
 "command": ["mytool", "--model", "{model}", "--effort", "{effort}", "--prompt", "{prompt_file}", "--cwd", "{checkout}"],
 "models": {"vendor/model": ["low"]}}
```

| Field | Rule |
| --- | --- |
| `command` | Text words. The first word is the executable. It cannot start with `-` or contain `=`. One word must contain `{model}`. Other words can contain only `{prompt_file}`, `{model}`, `{effort}` and `{checkout}` placeholders. |
| `output` | `codex`, `claude` or `session` JSONL. Tokate reads it with the parser of that format. |
| `models` | Required. Session output must report this provider and model. |

Tokate reads only policy version 3. Convert older policy files before init.
Re-approve open tasks when the setup PR changes task fields.

## Approve an issue and donor

1. Inspect access requests.

   ```sh
   tokate access
   ```

2. Trust a donor for future approved tasks.

   ```sh
   tokate access trust DONOR
   ```

3. Create an issue with `gh issue create` or the GUI. Include scope and acceptance criteria.
   To allow one donor without persistent trust, name that donor after the issue.

   ```sh
   tokate approve 42 DONOR
   ```

4. Or approve the issue for donors who meet the repository eligibility policy.

   ```sh
   tokate approve 42
   ```

   Use `--base-branch BRANCH` to change its target. The policy target or default branch
   is used when this flag is absent. Every approval asks once in a terminal.
   JSON and non-terminal approval preview without changes unless you pass `--yes`.

   At claim, the coordinator records the target tip in the reservation. Work and
   receipts use that base. The tip must descend from the approved revision.
   A changed policy at the tip makes the approval stale. Approve the issue again.

You can also add `tokate:approved` to an issue on GitHub. The coordinator checks
that the label sender has write, maintain or admin permission, then records approval.
It keeps the previous non-revoked target branch, or uses the default branch.
An unauthorized label is removed. An already valid approval is kept.
Use `tokate approve N --base-branch BRANCH` to change a target. Use `--yes` to apply without a prompt.

Access requests are plain comments and grant no access. Use `access trust DONOR`
or `approve ISSUE DONOR` after review. Re-approval replaces the allowed donor
list. Old issue grants grant no access in 0.7.0. Re-approve with a donor where needed.

Issue, task-field or PR-template changes need fresh approval. Task fields are
verification commands, required checks, protected paths, tools and their models,
runtime, maintainer edits, unlimited-coding limits and reservation duration. Formatting,
eligibility, target-branch defaults and descriptive text keep approvals valid.
Current eligibility still controls claims, work and publication. `tokate init`
lists affected approved issues and the commands to run after the change is merged.
`tokate status 42` reports stale task fields and the owner approval command.

Tokate keeps its records in `tokate/` branches of your repository. Init names them. Keep them.

| Branch | Holds |
| --- | --- |
| `tokate/access` | Donor trust and denials |
| `tokate/contributions/N` | Reservation and publication record for issue N |

Do not delete these branches, open PRs from them or merge them. Exclude them from branch cleanup. Deleting `tokate/access` removes all trust and deny entries. Deleting a contribution branch removes that issue's record.

Donor PR head branches, such as `tokate/v2-...`, are in donor forks. They are not records.

## Review and merge

1. Inspect the PR diff and its public change report.

   ```sh
   gh pr diff 10
   gh pr view 10
   ```

2. Approve fork workflow runs in GitHub after diff review, if GitHub holds them.
   Donor PRs come from forks. The repository setting **Actions > General > Approval for running
   fork pull request workflows from contributors** controls the hold. The GitHub default holds
   runs for first-time contributors. A donor stops being first-time after a merged contribution.
   **Require approval for all external contributors** holds runs for every donor who is not a
   repository or organization member.
   Init does not change this setting. `tokate checks` reports held runs as
   `Workflow runs await owner approval.` With `--watch`, it stops at once with exit 8
   because only the owner can approve the runs.
3. Check the receipt against owner approval and wait for required checks on the current PR head.

   ```sh
   tokate checks 10 --watch
   ```

   Checks returns pending with exit 8 while the coordinator adopts a submitted PR
   or GitHub makes a pushed head available. Wait, then run checks again.
   Direct code commits after the receipt need owner review and a verified amendment.
   Closed or merged PRs return exit 1 with `invalid_state`. Their gates are not evaluated.

4. Review scope, acceptance criteria, limitations and conflicts.
5. Mark the accepted draft ready.

   ```sh
   gh pr ready 10
   ```

6. Merge with your repository's required merge method.

   ```sh
   gh pr merge 10
   ```

Checks do not accept the task or merge the PR. Checks accept clean target-branch merges after the receipt head. Other later changes need owner review and a verified amendment. Required CI checks use the exact current PR head.

## Update the coordinator

The default workflow calls `obselate/tokate/.github/workflows/tokate-shared.yml@v0`.
It follows releases automatically. The shared workflow resolves its exact executed
commit, selects that commit's release and checks the release archive checksum.
No repository PR is needed for each patch or minor release.

To migrate an existing setup, run `tokate init OWNER/REPO --yes` once and merge the setup PR.

For an exact release commit instead, update the local CLI, then preview and apply:

```sh
tokate update --yes
tokate init OWNER/REPO --pin
tokate init OWNER/REPO --pin --yes
```

Review and merge the setup PR. Pin mode needs this step for each coordinator update.
Run init without `--pin` to return to `v0`. Doctor accepts both forms and reports version
differences only for exact pins. See [donors](donors.md), [arguments](arguments.md) and [recovery](recovery.md).

## If something fails

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `Pass --yes to apply the previewed setup. Nothing changed.` | Review the preview, then use the same `tokate init` flags with `--yes`. |
| `Approval revoked or task changed.` followed by the issue text or approval-label reason | Owner: review the task, then run the named `tokate approve OWNER/REPO#42` command. |
| `Repository policy or template changed. The owner must approve again.` followed by a task-field or template reason and an approval command | Owner: run the named `tokate approve OWNER/REPO#42` command. |
| `GitHub has not started CI for this head yet. Use tokate checks --watch to wait for CI.` | `tokate checks 10 --watch` |
| `Workflow runs await owner approval. Inspect the PR diff, then approve the linked runs in GitHub.` | `gh pr view 10 --web` |
