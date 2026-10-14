# Accept donations

Set up a repository for current main. Approve tasks, then review donated work before merge.

Check an existing repository with `tokate doctor owner OWNER/REPO` or add `--json` for structured results.
It reads the coordinator pin, latest release, Actions settings, policy, access record,
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

3. Preview and apply the setup. No checkout is necessary.

   ```sh
   tokate init OWNER/REPO --verification '[["bash","scripts/verify.sh"]]' --required-checks '["verify"]'
   ```

   Use the project's real test command and CI check names. Verification takes JSON argv arrays.
   Defaults: the default branch as target, `trusted` access, and codex, claude and pi with any model.
   Use `--eligibility open`, `--base-branch BRANCH`, `--max-time TIME`,
   `--reservation-time TIME` and `--allowed-tools JSON` to change choices.
   Existing policy values are kept unless a flag changes them.

   Init checks GitHub authentication and write access. Before a change, it lists:

   | Item | Change |
   | --- | --- |
   | Actions workflow permissions | Allow GitHub Actions to create and approve pull requests. Default permissions stay. |
   | Actions event policy | Allow `issues`, `issue_comment`, `pull_request_target` and `workflow_call` for the coordinator workflow. |
   | Actions allowlist | Add the pinned `obselate/tokate` shared workflow. Other entries stay. |
   | Branch protection | Require the policy checks on the target branch. |
   | `tokate/access` | Create the empty donor access record. |
   | `tokate-setup` | Create or advance a branch with `.github/tokate.json` and `.github/workflows/tokate-coordinator.yml`. |
   | Setup PR | Open a PR from `tokate-setup` into the default branch, or reuse the open one. |

   Each setting shows its current and proposed value. Steps that init cannot apply
   are printed as `Manual:` and listed in `data.manual`. Init asks once in a terminal.
   Add `--yes` to apply without a question. With `--json`, `--non-interactive` or no
   terminal and no `--yes`, it changes nothing and exits 0 with `applied=false`.

4. Review and merge the setup PR before task approval.

   ```sh
   gh pr merge tokate-setup
   ```

| Requirement | Check |
| --- | --- |
| Public GitHub repository | Repository visibility is public. |
| GitHub CLI and repository admin rights | `tokate init` checks them. |
| Actions is enabled | `gh api repos/OWNER/REPO/actions/permissions` |
| CI already ran on `main` | `gh run list --repo OWNER/REPO --branch main` |
| Test command works on Linux from a clean clone | Run your test command from the repository root. |
| No tracked build output | Keep generated build files out of Git. |

Init stops when Actions is disabled or an event policy blocks Tokate events. When
`local_only` or a blocking exclusion prevents the pinned workflow, init prints the
manual setting. Fix it before donors submit requests.

| Who can contribute? | Access |
| --- | --- |
| **Trusted people** | Trusted donors or donors with an issue grant. Newcomers request access first. |
| **Anyone eligible** | Authenticated GitHub users who are not denied. |

With no trusted donors, **Trusted people** requires an issue grant for each donor.
Version 2 `manual` eligibility is read as `trusted`. Version 3 accepts only `trusted` and `open`.

Owners do not need a coding tool or an AI subscription. Keep fork CI read-only and without secrets.

## Model permissions

Setup writes policy version 3. Each `allowed_tools` entry may contain a `models`
map from exact model names to effort arrays. Omit `models` to allow any model for
that harness/provider pair. Version 3 has no top-level `models` or `model_policy`.

```json
{"harness": "claude", "provider": "anthropic", "models": {"claude-sonnet-5-5": ["high"]}}
```

Pass the complete tool array with `--allowed-tools JSON` to edit per-tool models.

Version 2 remains readable. Its whitelist applies to every tool. Unrestricted
version 2 allows any model for each tool. Existing receipts and saved runs keep
these rules.

Init migrates a version 2 policy to version 3 and updates the coordinator pin in
the same setup PR. An older coordinator rejects version 3. Re-approve open tasks
after the setup PR is merged.

## Approval compatibility

Main binds approvals to canonical task fields after version 2 conversion.
Old whole-text approvals become stale once. Re-approve open tasks.
Version 2 policy remains readable. Old receipts and saved runs must still match
current approval authority. Re-approval does not restore an old approval identity.

## Approve an issue and donor

1. Inspect access requests.

   ```sh
   tokate access
   ```

2. Trust a donor for future approved tasks.

   ```sh
   tokate access trust DONOR
   ```

3. For access to only one issue, grant that issue instead.

   ```sh
   tokate access grant DONOR 42
   ```

4. Create an issue with `gh issue create` or the GUI. Include scope and acceptance criteria.
5. Approve that existing issue.

   ```sh
   tokate approve 42
   ```

   Use `--base-branch BRANCH` to change its target. The policy target or default branch
   is used when this flag is absent. Replacing an active reservation or published PR
   asks once in a terminal, or requires `--yes` in non-terminal use.

You can also add `tokate:approved` to an issue on GitHub. The coordinator checks
that the label sender has write, maintain or admin permission, then records approval.
It keeps the previous non-revoked target branch, or uses the default branch.
An unauthorized label is removed. An already valid approval is kept.
Use `tokate approve N --base-branch BRANCH` to change a target. Add `--yes` to replace active authority.

Access requests grant no access. Explicit denial blocks every access mode.

Issue, task-field or PR-template changes need fresh approval. Task fields are
verification commands, required checks, protected paths, tools and their models,
runtime and unlimited-coding limits, and reservation duration. Formatting,
eligibility, target-branch defaults and descriptive text keep approvals valid.
Current eligibility still controls claims, work and publication. `tokate init`
lists affected approved issues and the commands to run after the change is merged.
`tokate status 42` reports stale task fields and the owner approval command.

Tokate keeps its records in `tokate/` branches of your repository. Init names them. Keep them.

| Branch | Holds |
| --- | --- |
| `tokate/access` | Donor trust, grants and denials |
| `tokate/contributions/N` | Reservation and publication record for issue N |
| `tokate/synchronizations/...` | Your grants to update a donor PR from the target branch |

Do not delete these branches, open PRs from them or merge them. Exclude them from branch cleanup. Deleting `tokate/access` removes all trust and grants. Deleting a contribution branch removes that issue's record.

## Review and merge

1. Inspect the PR diff and its public change report.

   ```sh
   gh pr diff 10
   gh pr view 10
   ```

2. Approve first-time fork workflows in the PR's linked GitHub Actions runs after diff review.
3. Verify the receipt against owner approval.

   ```sh
   tokate verify 10
   ```

4. Wait for required checks on the current PR head.

   ```sh
   tokate checks 10 --watch
   ```

5. Review scope, acceptance criteria, limitations and conflicts.
6. Mark the accepted draft ready.

   ```sh
   gh pr ready 10
   ```

7. Merge with your repository's required merge method.

   ```sh
   gh pr merge 10
   ```

Checks do not accept the task or merge the PR. Target movement needs synchronization only for conflicts or required up-to-date branches.

## Update the coordinator

1. Update the local CLI.

   ```sh
   tokate update
   ```

2. Update the pin through a setup PR.

   ```sh
   tokate init OWNER/REPO
   ```

   Init shows the current and proposed workflow and a comparison URL for the shared
   workflow commits. It adds the new exact commit to a selected-actions allowlist and
   keeps other entries. Remove the old exact entry after the new workflow runs.
   A custom workflow with the current pin stays unchanged.

3. Review and merge the setup PR.

The local update does not change the repository pin. See [donors](donors.md), [arguments](arguments.md) and [recovery](recovery.md).

## If something fails

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `Pass --yes to apply the previewed setup. Nothing changed.` | Review the preview, then use the same `tokate init` flags with `--yes`. |
| `Approval revoked or task changed.` followed by the issue text or approval-label reason | Owner: review the task, then run the named `tokate approve OWNER/REPO#42` command. |
| `Repository policy or template changed. The owner must approve again.` followed by a task-field or template reason and an approval command | Owner: run the named `tokate approve OWNER/REPO#42` command. |
| `GitHub has not started CI for this head yet. Use tokate checks --watch to wait for CI.` | `tokate checks 10 --watch` |
| `Workflow runs await owner approval. Inspect the PR diff, then approve the linked runs in GitHub.` | `gh pr view 10 --web` |
