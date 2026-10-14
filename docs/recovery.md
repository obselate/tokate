# Recover or update work

Find the code or message below, then use the action in its row. Keep the original checkout and saved evidence.

1. List saved attempts. Add `--all` to include finished attempts.

   ```sh
   tokate status --all
   ```

2. Inspect the exact attempt and its next action.

   ```sh
   tokate status 42-1 --json
   ```

3. Use the saved directory when a name is not unique.

   ```sh
   tokate status --run DIR --json
   ```

`DIR` is the run directory shown by Tokate. `PR` is the pull request number, `DONOR` is the GitHub login, and `SHA` is an exact commit.

Bare `42` selects the newest attempt for commands that take a run. Use `42-1` for attempt 1, not another attempt with a better-looking state.

Do not edit `run.json` or delete evidence to bypass a failure.

## Correct a rejected public summary

If coding completed but the public summary was rejected, keep the saved run.
Correct `tokate-public-summary.json` in its `checkout` directory, then run:

```sh
tokate submit --run DIR
```

Tokate checks the corrected summary and runs owner verification before publication.
It uses the completed work without new inference. Do not start another run.

## Correct completed work before publication

1. Archive the completed evidence before editing.

   ```sh
   tokate amend 42-1
   ```

2. Edit the run's `checkout` directory.
3. Commit the corrected files in that checkout.

   ```sh
   git add FILES
   git commit -m "Correct donated work"
   git rev-parse HEAD
   ```

4. Declare the actual correction tools in `TOOLS_FILE` and the public summary in `SUMMARY_FILE`.
5. Verify and request publication of the exact corrected commit with a separate budget.

   ```sh
   tokate amend 42-1 --commit SHA --time 5m --tools TOOLS_FILE --summary SUMMARY_FILE
   ```

6. After the coordinator publishes the draft, record its result.

   ```sh
   tokate submit 42-1
   ```

`--commit` defaults to HEAD of the saved checkout. A call with no budget or commit archives the original evidence. This path requires completed original inference. For stopped or failed inference, use fresh preparation under current authority and an explicit new budget.

## Amend a published PR

1. Edit and commit the saved checkout.
2. Describe the complete final diff in `SUMMARY_FILE`.
3. Declare the actual editing tools in `TOOLS_FILE`.
4. Verify and publish the exact commit.

   ```sh
   tokate amend 42-1 --commit SHA --time 5m --tools TOOLS_FILE --summary SUMMARY_FILE
   ```

5. Request fresh CI and owner review.

   ```sh
   tokate checks PR --watch
   ```

## Synchronize a published PR

1. Check GitHub mergeability and branch requirements.

   ```sh
   tokate checks PR
   ```

2. For conflicts or a required up-to-date branch, merge the current target without inference.

   ```sh
   tokate reconcile 42-1
   ```

3. Resolve and commit any conflicts in the saved checkout.
4. Resume reconciliation after conflict resolution.

   ```sh
   tokate reconcile 42-1 --resume
   ```

5. Ask the owner to authorize the exact candidate `C` and target `U` shown by reconciliation.

   ```sh
   tokate authorize-sync PR --commit C --upstream U
   ```

6. Use the returned grant `G` to verify and publish the candidate.

   ```sh
   tokate amend 42-1 --commit C --sync G --time 5m --tools TOOLS_FILE --summary SUMMARY_FILE
   ```

Target movement alone does not fail checks. Synchronize only when GitHub reports a conflict or requires an up-to-date branch.

If the target moves before a sync amendment finishes recording, keep the saved
candidate and amendment. Run `tokate reconcile 42-1`. It checks remote publication
and coordination evidence, records an accepted amendment when safe, and prepares
the next reconciliation against the current target. It does not repeat publication.
Obtain a new owner grant for the next exact candidate and target.

## Continue stopped work

For a Codex, Pi or OMP managed run stopped with `Runtime limit reached`, keep its checkout and use a fresh attempt. This example uses issue 42 and adds a two-hour total budget with 20 minutes reserved for verification. The policy must permit that budget.

1. Inspect the stopped run. Status for a time-limit failure reads current authority and shows the continuation command with its current state SHA.

   ```sh
   tokate status --run PRIOR_RUN_DIR --json
   ```

2. If the stopped attempt is still active, pause it. Wait for coordinator acceptance. If pending, inspect status and run the same pause command after acceptance to record the outcome.

   ```sh
   tokate pause --run PRIOR_RUN_DIR
   tokate status --run PRIOR_RUN_DIR --json
   ```

3. Resume the paused lease to get a fresh attempt. Wait for coordinator acceptance. If pending, inspect status and run the same resume command after acceptance to record the outcome.

   ```sh
   tokate resume --run PRIOR_RUN_DIR
   tokate status --run PRIOR_RUN_DIR --json
   ```

4. Use the continuation command from this last status read. Keep its exact `--state`, `--continue-from` and original tool and fork options. Change only the new budget to `--time 2h --verify-time 20m`. For an original Codex selection of `gpt-6.1-sol` with high effort, the complete command is below. Use the `--fork` value from status for `SAVED_HEAD_REPO`.

   ```sh
   tokate prepare OWNER/REPO#42 --state CURRENT_STATE_SHA --source tokate \
     --harness codex --provider openai --model gpt-6.1-sol --effort high \
     --continue-from PRIOR_RUN_DIR --fork SAVED_HEAD_REPO --time 2h --verify-time 20m --yes
   ```

5. Use the new run directory printed by preparation to run the fresh attempt.

   ```sh
   tokate work --run NEW_RUN_DIR --yes
   ```

6. Publish the new verified attempt.

   ```sh
   tokate submit --run NEW_RUN_DIR
   ```

Continuation accepts stopped, unpublished managed work from the same donor under unchanged approval. Pi keeps its original model, runtime and endpoint.

If preparation says `Saved contribution already exists`, use the saved directory and pause/resume commands in the refusal. Do not delete or overwrite that run.

See [donors](donors.md), [owners](owners.md) and [argument names](arguments.md). The [public summary format](../AGENTS.md#write-public-pr-summaries) defines `SUMMARY_FILE`.

## If something fails

Messages with `DIR` below contain your actual run path. Use that path in the command.

For Contributions, Publication and Execution commands, match `error.code` in `--json` output and the symptom below.
Keep saved work and inspect current state before any explicit next action.

| Code | Symptom (message text or failure) | Do |
| --- | --- | --- |
| `invalid_state` | `An unexpired reservation already owns this contribution` or `Reservation state does not permit this operation` | Inspect `tokate status --run DIR --json` and use the existing reservation. |
| `invalid_state` | `Preparation is incomplete` or `Continuation import is incomplete` followed by the saved command | Use `tokate prepare --run DIR` after inspecting the saved evidence. |
| `invalid_state` | `Ambiguous or incomplete fork discovery` or `Incomplete fork discovery after 60 seconds` | Select `--fork DONOR/NAME` explicitly in a fresh preparation. |
| `invalid_state` | Malformed coordination data, unsafe continuation paths or changed capture evidence | Preserve the run and inspect the indicated data. Do not edit authority or evidence to bypass validation. |
| `stale_approval` | `Saved run has stale coordination authority`, `Handoff source or approval changed` or `Synchronization target moved` | Inspect `tokate status --run DIR --json`. The owner must review changed authority or issue a fresh exact synchronization grant. |
| `stale_approval` | `Saved fork repository identity changed` | Inspect the original repository and fork before further work. |
| `authentication_required` | `Active GitHub account differs from the saved donor` | Use the original donor account and inspect `tokate status --run DIR --json`. |
| `command_failed` | Required remote evidence could not be read or saved data could not be written | Inspect partial status and the remote or file access failure before an explicit next action. |

### Publication failure codes

Amendment publication keeps the underlying error code. Inspect saved publication intent before continuing.

| Code | Symptom (message text or failure) | Do |
| --- | --- | --- |
| `invalid_state` | `No PR has been published for this run` | Inspect `tokate status --run DIR --json` before submitting or reading checks. |
| `invalid_state` | `Public summary needs bounded changes, verification and limitations lists`, `Set head in the summary to SHA.` or invalid public text | Supply a valid summary for the exact candidate before an explicit submit or amend command. |
| `invalid_state` | Malformed or ambiguous Tokate receipt or report, unsupported receipt protocol, missing public report or changed original evidence | Preserve saved evidence. Restore the report from its current authority or declare a corrected candidate. |
| `invalid_state` | `incomplete_turn:` followed by the failure | Correction requires a completed successful inference turn. Inspect stopped work before continuation or incomplete publication. |
| `invalid_state` | `interrupted_publication:` followed by incomplete, invalid or ambiguous physical PR history | Inspect physical PRs and saved intent before resuming publication. Do not create another request to bypass the refusal. |
| `invalid_state` | `Saved amendment INPUT input differs or cannot be read.` | Restore the original input or declare a new exact commit with a new verification budget. |
| `stale_approval` | Receipt, handoff, continuation, amendment or synchronization evidence differs from coordination authority | Inspect current approval, PR head and coordination evidence before acceptance. The owner must resolve changed authority. |
| `stale_approval` | `Saved version-2 publication intent changed`, `Physical PR and remote branch disagree` or changed original authority | Preserve the saved run and inspect remote state. Do not overwrite the branch or edit authority to bypass validation. |
| `verification_failed` | Correction or amendment owner verification failed or its budget was exhausted | Inspect saved verification results and declare a corrected exact commit with an explicit budget. |
| `command_failed` | `No POST retry made.` after uncertain request evidence | Inspect remote comments and coordination state before resuming the same saved intent. No automatic POST retry is made. |
| `command_failed` | `Cannot read workflow runs awaiting approval`, `Cannot read workflow runs for this head` or bounded history exceeded | Inspect incomplete CI evidence before acceptance. Missing evidence is not success. |
| `command_failed` | Original evidence could not be captured or corrected remote commit is missing after push | Preserve saved evidence and inspect file access or remote state before an explicit next action. |

### Execution failure codes

Execution keeps saved failure stages, interruption evidence and verification results.

| Code | Symptom (message text or failure) | Do |
| --- | --- | --- |
| `invalid_state` | `This destination attempt already started execution`, changed saved runtime, malformed installation metadata or invalid external history | Inspect `tokate status --run DIR --json`. Keep the original runtime and saved evidence. Do not start inference again in that attempt. |
| `invalid_state` | `No changes returned. No PR will be opened.`, changed candidate, unsafe saved paths or protected owner content changes | Inspect the checkout and saved evidence before explicit recovery or fresh preparation. |
| `invalid_arguments` | `Runtime overrides require bounded absolute paths` or `Invalid runtime path` | Supply a valid absolute runtime path before starting work. |
| `missing_tools` | Missing executable, unsupported native runtime or failed native capability checks | Repair the selected installation, then run `tokate doctor managed`. No inference has started. |
| `authentication_required` | Codex login or Claude native authentication did not confirm the required account | Sign in with the selected harness and original account before work. |
| `inference_failed` | Failed, incomplete, conflicting or truncated harness output, or coding cancelled or timed out | Inspect `tokate status --run DIR --json` and private capture evidence. Preserve partial work before fresh preparation with an explicit budget. |
| `verification_failed` | Missing independent results, unsafe runtime layout, owner checks failed, or verification cancelled or timed out | Inspect saved verification results before an explicit correction or amendment. |
| `endpoint_unavailable` | Pi endpoint metadata is unavailable, malformed or does not advertise the selected model | Inspect the configured local service and exact model before fresh preparation. |
| `stale_approval` | `Preserved external authority changed` | Preserve external history and inspect current owner authority before further work. |
| `command_failed` | `Runtime allowance exhausted` or run storage could not be read or written | Inspect saved state and private command evidence before any explicit next action. |

### Setup

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `Required tools are missing or failed diagnostics. Run doctor.` | Owner: `tokate doctor owner --auth --fix --yes` |
| `Authentication is required with the appropriate account.` | `gh auth login` |
| `Pass --yes to apply the previewed project setup. Nothing changed.` | Review the preview, then use the same `tokate init` flags with `--yes`. |

### Claim and work

Claim, work, submit and status warn when the default branch coordinator member
version is older than the CLI. The warning does not block donor commands. The
owner must review and install the entry generated by the named
`tokate coordinator-setup OWNER/REPO --output tokate-coordinator.yml` command.
If the version check is unavailable, commands continue with a warning.

| Symptom (message text) | Do (exact command) |
| --- | --- |
| `Claim pending.` with `work --run DIR` and `prepare --run DIR` | Managed donor: inspect status, then use `tokate work --run DIR`. If the workflow failed, use owner recovery below first. |
| `Claim pending.` with `prepare --run DIR` only | External donor: inspect status, then use `tokate prepare --run DIR`. If the workflow failed, use owner recovery below first. |
| `Tokate coordinator is still running. RUN_URL` | Wait for the linked run, then inspect `tokate status --run DIR`. |
| `Tokate workflow failed. MESSAGE RUN_URL` followed by the recovery text below | Owner: inspect the linked failure and re-process the request after fixing its cause. `MESSAGE` is the first failure annotation, limited to 1024 characters, when available. |
| `GitHub could not start the Tokate workflow. The usual cause is that the repository's Actions settings do not allow obselate/tokate/.github/workflows/tokate-shared.yml at the pinned commit. RUN_URL` followed by the recovery text below | Owner: allow the pinned shared workflow in Actions settings, then re-process the request. |
| `Approval revoked or task changed.` followed by the issue text or approval-label reason | Owner: review the task, then run the named `tokate approve OWNER/REPO#42` command. |
| `Repository policy or template changed. The owner must approve again.` followed by `Approval no longer matches current task fields.` or `PR template changed.` and an approval command | Owner: run the named `tokate approve OWNER/REPO#42` command. |
| `The reservation is gone. Return to the owner.` | `tokate status OWNER/REPO#42` |
| `Selected model is donor-reported unavailable. No retry or fallback.` | `tokate select OWNER/REPO` |
| `Model is donor-reported unavailable.` | `tokate select OWNER/REPO` |
| `No saved runs.` | `tokate status OWNER/REPO#42` |
| `The saved run or command state does not permit this operation. Inspect its artifacts.` | `tokate status 42-1 --json` |

For a pending claim, inspect the failed workflow before resuming the saved command. A rerun repeats the same coordinator version. If that version caused the failure, the owner must update the coordinator, then run:

```sh
tokate recover-request OWNER/REPO#42
```

This command uses the installed coordinator and the owner's current GitHub login.
It requires repository write permission and processes the latest unprocessed request
comment with the same validation as the workflow. Recorded requests cannot be
recovered. Inspection is limited to 1000 issue comments and fails at that limit.
Do not repost an identical request. After owner recovery, resume with the saved run.

Formatting, eligibility and descriptive policy edits keep approvals valid. Current
eligibility still controls donor access. Task-field or PR-template changes need
fresh owner approval. After upgrading to current main, approvals made with the
old whole-text digest become stale once. Use the owner command shown by status.
Refusals name changed task fields when the approved policy can be read and its
task digest matches. Otherwise they state that previous task fields are unavailable
or use a legacy digest. Issue text and PR-template changes are named separately.

Model and effort permissions apply to the exact harness/provider pair. Use `tokate policy OWNER/REPO` to inspect that tool's models before `tokate select OWNER/REPO`. A tool with no models map allows any model.

For a provider capacity error, inspect the saved run before selecting a different model. Tokate has no automatic retry or fallback.

### Verification

| Symptom (message text) | Do (exact command) |
| --- | --- |
| `Owner verification failed. Inspect the private verification.json artifact before explicit recovery.` | `tokate status 42-1 --json` |
| `Independent verification failed. Inspect the private verification artifact.` | `tokate status 42-1 --json` |
| `Owner verification did not pass` | `tokate status 42-1 --json` |
| `Amendment owner verification failed` | `tokate status 42-1 --json` |

Open the private verification artifact listed by status. Correct completed or published work with `amend` using the steps above.

### Submit and publication

| Symptom (message text) | Do (exact command) |
| --- | --- |
| `Submit pending. Run the same command again: tokate submit --run DIR` | No workflow result was available. Inspect `tokate status --run DIR` before `tokate submit --run DIR`. |
| `Tokate coordinator is still running. RUN_URL` | Wait for the linked run, then inspect `tokate status --run DIR`. |
| `Tokate workflow failed. MESSAGE RUN_URL` or `GitHub could not start the Tokate workflow.` with Actions settings guidance and recovery text | Owner: use the pending request recovery above. |
| `GitHub mutation failed (HTTP STATUS). GitHub reason: MESSAGE.` followed by uncertain-outcome guidance | Inspect remote state, then use `tokate submit --run DIR`. `STATUS` and `MESSAGE` contain the HTTP status and bounded GitHub message fields when present. No automatic retry is made. |
| `Publication attempt fence was invalidated or replaced` | `tokate status --run DIR --json` |
| `No saved amendment request. Start a new amendment with --time.` | `tokate amend 42-1 --time 5m --tools TOOLS_FILE --summary SUMMARY_FILE` |

After owner recovery, repeat a pending publication with the same saved intent. Do not start another run to bypass it.

### Review and checks

| Symptom (message text) | Do (exact command) |
| --- | --- |
| `GitHub has not started CI for this head yet. Use tokate checks --watch to wait for CI.` | `tokate checks PR --watch` |
| `Workflow runs await owner approval. Inspect the PR diff, then approve the linked runs in GitHub.` | Owner: `gh pr view PR --web` |
| `GitHub reports a conflict or requires an up-to-date branch. Ask the current donor to reconcile and verify the resulting exact commit. Further coding requires a new explicit budget.` | Donor: `tokate reconcile 42-1` |
| `No published PR` with saved-publication guidance | `tokate status 42-1 --json` |

Approve a fork workflow only after diff review. For a stale PR, refresh `tokate checks PR` and use synchronization above if required.

### Access

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `Donor access record is missing.` after the eligibility mode | Owner: run the named `tokate access init OWNER/REPO` command, then restore trust or issue grants. |
| `Missing donor trust and issue grant.` after the eligibility mode | Owner: run the named `tokate access grant DONOR OWNER/REPO#42` command for one issue, or `tokate access trust DONOR OWNER/REPO` for all issues. |
| `Donor is denied.` after the eligibility mode | Owner: run the named `tokate access restore DONOR OWNER/REPO` command. In trusted mode the donor still needs trust or an issue grant. |
| `Donor access authority is unavailable or malformed. Inspect owner-controlled access before proceeding.` followed by the owner command | Owner: run the named `tokate access list OWNER/REPO` command and inspect the access authority. |
| `Issue is not approved.` or `Issue approval is revoked or its approval label is missing.` | Owner: review the task, then run the named `tokate approve OWNER/REPO#42` command. |
| `Issue text changed since approval.` | Owner: review the changed issue, then run the named `tokate approve OWNER/REPO#42` command. |

An access request does not grant eligibility. In `trusted` mode, the owner must trust the donor or grant the issue. In `open` mode, anyone not denied is eligible. Version 2 `manual` is read as `trusted`.

### Update

| Symptom (message text) | Do (exact command) |
| --- | --- |
| `Nix manages this installation. Use nix profile upgrade/remove or update your NixOS configuration.` | Profile installation: `nix profile upgrade tokate` |
| `Generate to a new file outside protected .github paths` | `tokate coordinator-setup OWNER/REPO --output tokate-coordinator.yml --yes` |
| `Running binary does not match the released archive member` | `tokate update` |
| `Release archive checksum mismatch` | `tokate update` |

After a local update, update the repository's coordinator pin with the [owner steps](owners.md#update-the-coordinator). Update the pin before committing a version 3 policy. Older coordinators reject version 3. Version 2 receipts and saved runs remain readable.
