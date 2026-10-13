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

3. Check the owner tools and authentication.

   ```sh
   tokate doctor owner --auth
   ```

4. Check that Actions permits the `obselate/tokate` reusable workflow.

   ```sh
   gh api repos/OWNER/REPO/actions/permissions
   ```

5. Open your repository checkout.

   ```sh
   cd /path/to/repo
   ```

6. Start setup.

   ```sh
   tokate init OWNER/REPO
   ```

7. On **Target branch**, press Enter to keep the default branch.
8. On **GitHub Actions settings**, review the listed changes. Select **Apply** to make them or **Cancel** to stop setup.
9. On **Who can contribute?**, select one access mode from the table below.
10. On **Allowed models**, select a tool if asked, then **Any supported model** or **Choose allowed models**.
11. In the model checklist, select the exact models and reasoning levels for that tool. Use Space to select, Enter to accept, or F2 to add a model.
12. On **Verification commands**, enter one test command at a time. Press Enter on a blank prompt to finish.
13. Use repository-relative paths in each command. Tokate runs each command with `/bin/sh -c` from the repository root.
14. On **Required GitHub checks**, select a check or enter exact CI check names separated by commas. Use real names from CI that already ran on the target branch.
15. On **Review project setup**, review the rules. Use **Change checks, times or PR settings**, **Review allowed models**, or **Change tools** to change them.
16. Select **Create policy files**.
17. On **GitHub branch protection**, select **Apply** to require the listed checks or **Skip** to leave protection unchanged.
18. Commit the generated files.

   ```sh
   git add .github
   git commit -m "Set up Tokate"
   ```

19. Push them to the default branch before task approval.

   ```sh
   git push
   ```

20. Initialize donor access.

   ```sh
   tokate access init
   ```

| Requirement | Check |
| --- | --- |
| Public GitHub repository | Repository visibility is public. |
| Git, GitHub CLI and repository admin rights | `tokate doctor owner --auth` |
| Actions permits the `obselate/tokate` reusable workflow | `gh api repos/OWNER/REPO/actions/permissions` |
| CI already ran on `main` | `gh run list --repo OWNER/REPO --branch main` |
| Test command works on Linux from a clean clone | Run your test command from the repository root. |
| No tracked build output | Keep generated build files out of Git. |

Init checks the pinned shared workflow against Actions settings. A problem or an
unavailable settings read produces a warning with a repair step. It does not block
local file generation. Fix the setting before donors submit requests.

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

Use **Review allowed models** to edit one tool. For noninteractive setup, pass the
complete tool array with `--allowed-tools JSON`. The `--model-policy whitelist --models JSON` shortcut copies the same map to each selected tool.

Version 2 remains readable. Its whitelist applies to every tool. Unrestricted
version 2 allows any model for each tool. Existing receipts and saved runs keep
these rules.

Update the coordinator pin before committing a version 3 policy. An older
coordinator rejects version 3. Follow the update steps below, then run `tokate init`
to migrate and re-approve open tasks after the policy is merged.

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

4. Create and approve a new issue.

   ```sh
   tokate approve
   ```

5. On **Write an issue**, enter a short title.
6. On **Describe the issue**, enter scope, acceptance criteria and failure cases. Press Enter on a blank line to finish.
7. On **Review issue**, select **Create and approve** or **Cancel**.
8. On **Target branch**, select the branch that receives the work.
9. To approve an existing issue, use its number instead.

   ```sh
   tokate approve 42
   ```

10. If **Replace approval** appears, select **Re-approve** only to replace the current approval. Select **Cancel** to keep it.

You can also add `tokate:approved` to an issue on GitHub. The coordinator checks
that the label sender has write, maintain or admin permission, then records approval.
It keeps the previous non-revoked target branch, or uses the default branch.
An unauthorized label is removed. An already valid approval is kept.
Use `tokate approve` to choose another target or explicitly replace a reservation.

Access requests grant no access. Explicit denial blocks every access mode.

Issue, task-field or PR-template changes need fresh approval. Task fields are
verification commands, required checks, protected paths, tools and their models,
runtime and unlimited-coding limits, and reservation duration. Formatting,
eligibility, target-branch defaults and descriptive text keep approvals valid.
Current eligibility still controls claims, work and publication. `tokate init`
lists affected approved issues and the commands to run after the change is merged.
`tokate status 42` reports stale task fields and the owner approval command.

Tokate keeps its records in `tokate/` branches of your repository. Keep them.

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

2. Generate a matching pinned workflow entry outside `.github` and update its Actions allowlist entry.

   ```sh
   tokate coordinator-setup OWNER/REPO --output tokate-coordinator.yml --yes
   ```

   The command prints the old and new versions and pins, a comparison URL, a release URL and the proposed file. Review them before applying. With `--yes`, it checks Actions permissions, adds the new exact commit and keeps existing entries. Remove the old exact entry after the new workflow runs. Other entries and selected-action options stay unchanged. If the token cannot change the setting, it prints the exact setting and value to change. Complete that manual change before installing the workflow. Noninteractive preview without `--yes` changes no files or settings. Interactive setup asks before applying.

   In Settings > Actions > General > Actions permissions, the pattern `obselate/tokate/.github/workflows/tokate-shared.yml@*` survives pin updates. The workflow itself stays pinned to an exact commit. An exact allowlist commit needs an update with each pin. Blocking exclusions, disabled Actions and organization restrictions need owner review. Setup does not remove exclusions or enable Actions.

3. Review the generated file against the existing coordinator workflow.
4. Replace the existing workflow entry with the new pin. Keep required custom settings and use only one coordinator.
5. Commit and push the workflow.

   ```sh
   git add .github
   git commit -m "Update Tokate coordinator"
   git push
   ```

The local update does not change the repository pin. See [donors](donors.md), [arguments](arguments.md) and [recovery](recovery.md).

## If something fails

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `GitHub settings were not changed` | `tokate init OWNER/REPO` |
| `Approval revoked or task changed.` followed by the issue text or approval-label reason | Owner: review the task, then run the named `tokate approve OWNER/REPO#42` command. |
| `Repository policy or template changed. The owner must approve again.` followed by a task-field or template reason and an approval command | Owner: run the named `tokate approve OWNER/REPO#42` command. |
| `GitHub has not started CI for this head yet. Use tokate checks --watch to wait for CI.` | `tokate checks 10 --watch` |
| `Workflow runs await owner approval. Inspect the PR diff, then approve the linked runs in GitHub.` | `gh pr view 10 --web` |
