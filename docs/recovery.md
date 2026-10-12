# Recover or update work

Find the message below, then run the command in its row. Keep the original checkout and saved evidence.

1. List saved attempts.

   ```sh
   tokate runs
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

Do not edit `run.json` or delete evidence to bypass a failure. In a picker, `h` or Esc returns home. In a text input, use Esc.

## Correct completed work before publication

1. Archive the completed evidence before editing.

   ```sh
   tokate recover 42-1
   ```

2. Edit the run's `checkout` directory.
3. Commit the corrected files in that checkout.

   ```sh
   git add FILES
   git commit -m "Correct donated work"
   git rev-parse HEAD
   ```

4. Declare the actual correction tools in `TOOLS_FILE` and the public summary in `SUMMARY_FILE`.
5. Verify the exact corrected commit with a separate budget.

   ```sh
   tokate recover 42-1 --commit SHA --time 5m --tools TOOLS_FILE --summary SUMMARY_FILE
   ```

6. Publish verified work.

   ```sh
   tokate submit 42-1
   ```

This path requires completed original inference. For stopped or failed inference, use fresh preparation under current authority and an explicit new budget.

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

## Continue stopped work

1. Inspect the stopped run and current issue authority.

   ```sh
   tokate status --run PRIOR_RUN_DIR --json
   tokate coordination OWNER/REPO#42
   ```

2. Establish a fresh active attempt through the coordinator lease transition shown by status.
3. Prepare from the stopped run with the original tool and a new budget.

   ```sh
   tokate prepare OWNER/REPO#42 PROFILE --state CURRENT_STATE_SHA --source tokate \
     --continue-from PRIOR_RUN_DIR --time 1h --verify-time 20m --yes
   ```

4. Run the fresh attempt.

   ```sh
   tokate work 42 --yes
   ```

5. Publish the new verified attempt.

   ```sh
   tokate submit 42
   ```

Continuation accepts stopped, unpublished managed work from the same donor under unchanged approval. Pi keeps its original model, runtime and endpoint.

See [donors](donors.md), [owners](owners.md) and [argument names](arguments.md). The [public summary format](../AGENTS.md#write-public-pr-summaries) defines `SUMMARY_FILE`.

## If something fails

Messages with `DIR` below contain your actual run path. Use that path in the command.

### Setup

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `Required tools are missing or failed diagnostics. Run doctor.` | Owner: `tokate doctor owner --auth --fix` |
| `Authentication is required with the appropriate account.` | `gh auth login` |
| `GitHub settings were not changed` | `tokate init OWNER/REPO` |

### Claim and work

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `Claim pending. Run: DIR; resume explicitly with work --run DIR or prepare --run DIR. If the Tokate workflow failed, the owner reruns the failed workflow run in GitHub Actions, then the donor runs the same command again.` | Managed donor: `tokate work --run DIR` |
| `Claim pending. Run: DIR; resume explicitly with prepare --run DIR. If the Tokate workflow failed, the owner reruns the failed workflow run in GitHub Actions, then the donor runs the same command again.` | External donor: `tokate prepare --run DIR` |
| `Approval revoked or task changed` | Owner: `tokate approve 42` |
| `Repository policy or template changed. The owner must approve again.` | Owner: `tokate approve 42` |
| `The reservation is gone. Return to the owner.` | `tokate status OWNER/REPO#42` |
| `Selected model is donor-reported unavailable. No retry or fallback.` | `tokate select OWNER/REPO` |
| `Model is donor-reported unavailable.` | `tokate select OWNER/REPO` |
| `No saved runs.` | `tokate status OWNER/REPO#42` |
| `The saved run or command state does not permit this operation. Inspect its artifacts.` | `tokate status 42-1 --json` |

For a pending claim, run the same saved command again. If the Tokate workflow failed, the owner reruns that failed workflow in GitHub Actions first.

For a provider capacity error, inspect the saved run before selecting a different model. Tokate has no automatic retry or fallback.

### Verification

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `Owner verification failed. Inspect the private verification.json artifact before explicit recovery.` | `tokate status 42-1 --json` |
| `Independent verification failed. Inspect the private verification artifact.` | `tokate status 42-1 --json` |
| `Owner verification failed for the explicit correction; all results are preserved` | `tokate status 42-1 --json` |
| `Amendment owner verification failed; saved progress retained` | `tokate status 42-1 --json` |

Open the private verification artifact listed by status. Correct completed work with `recover`, or published work with `amend`, using the steps above.

### Submit and publication

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `Submit pending. Run the same command again: tokate submit --run DIR` | `tokate submit --run DIR` |
| `Publication attempt fence was invalidated or replaced` | `tokate status --run DIR --json` |
| `No saved amendment request. Start a new amendment with --time.` | `tokate amend 42-1 --time 5m --tools TOOLS_FILE --summary SUMMARY_FILE` |

Repeat a pending publication with the same saved intent. Do not start another run to bypass it.

### Review and checks

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `GitHub has not started CI for this head yet. Use tokate checks --watch to wait for CI.` | `tokate checks PR --watch` |
| `Workflow runs await owner approval. Inspect the PR diff, then approve the linked runs in GitHub.` | Owner: `gh pr view PR --web` |
| `GitHub reports a conflict or requires an up-to-date branch. Ask the current donor to reconcile and verify the resulting exact commit. Further coding requires a new explicit budget.` | Donor: `tokate reconcile 42-1` |
| `No published PR; inspect saved publication before reconciling.` | `tokate status 42-1 --json` |

Approve a fork workflow only after diff review. For a stale PR, refresh `tokate checks PR` and use synchronization above if required.

### Access

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `Current donor access does not permit this task. The owner must restore access or grant the required membership.` | Donor: `tokate access request 42 --trust`. Owner: `tokate access trust DONOR` for all tasks, or `tokate access grant DONOR 42` for one issue. If the donor was denied: `tokate access restore DONOR`. |
| `Donor access authority is unavailable or malformed. Inspect owner-controlled access before proceeding.` | Owner: `tokate access init`, then `tokate access trust DONOR` |

An access request does not grant eligibility. The owner must trust or grant the donor.

### Update

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `Nix manages this installation. Use nix profile upgrade/remove or update your NixOS configuration.` | Profile installation: `nix profile upgrade tokate` |
| `Generate to a new file outside protected .github paths; installation is an owner action after release` | `tokate coordinator-setup OWNER/REPO --output tokate-coordinator.yml --yes` |
| `Running binary does not match the released archive member` | `tokate update` |
| `Release archive checksum mismatch` | `tokate update` |

After a local update, update the repository's coordinator pin with the [owner steps](owners.md#update-the-coordinator).
