# Recover or update work

Start with `tokate runs`, then `tokate status RUN`. `RUN` is a name such as `42-3`,
or `--run DIR`. Keep the original checkout and evidence.
Do not edit `run.json`, delete branches, or start a second run to bypass a failure.
Commands below do not start inference unless they explicitly use `work`.

| State | Next action |
| --- | --- |
| Claim pending | Wait for the coordinator. `prepare --run DIR` checks acceptance without inference. |
| Interrupted preparation | Inspect saved state, then `prepare --run DIR`. |
| Failed inference | Preserve evidence. A new attempt needs current authority and a fresh donor budget. |
| Expired claim or stale approval | Return to the owner. |
| Verified work awaiting publication | `submit RUN`. |
| Existing PR needs changes | Use an amendment below. |
| Upstream moved | `reconcile RUN`, inspect conflicts, then obtain owner authorization for amendment. |

Always use `tokate help COMMAND` for the installed command's inputs and restrictions.
An uncertain remote write must be reconciled before another write. Repeating the
same saved intent may resume publication; it does not authorize new work.

## Correct completed work before publication

```sh
tokate recover RUN
```

This archives completed evidence. Edit and commit the `checkout` directory of the run, leaving a clean
candidate. Declare the actual correction tools separately from the original tools:

```sh
tokate recover RUN --commit SHA --time 5m --tools TOOLS_FILE --summary SUMMARY_FILE
tokate submit RUN
```

The correction uses a separate verification budget. Failed or incomplete original
inference cannot use this path.

## Amend a published PR

Edit and commit the saved checkout, then verify and publish that exact commit:

```sh
tokate amend RUN --commit SHA --time 5m --tools TOOLS_FILE --summary SUMMARY_FILE
```

A summary describes the entire final diff. Owner edits outside Tokate's PR-body
regions are preserved. Original execution and later editing remain separately
attributed. Fresh CI and owner review are still required.

If upstream moved, `reconcile RUN` merges the current target without inference.
Resolve conflicts and use `--resume`. The owner then issues `authorize-sync` for the
exact candidate and upstream commits. Pass that grant to `amend --sync GRANT`.

## Continue stopped work

Same-donor, unpublished managed work can seed a fresh attempt under unchanged
approval. A coordinator lease transition must first establish the fresh active
attempt. Then explicitly select the original tool and a new budget:

```sh
tokate prepare OWNER/REPO#42 PROFILE --state CURRENT_STATE_SHA --source tokate \
  --continue-from PRIOR_RUN_DIR --time 1h --verify-time 20m --yes
tokate work 42 --yes
tokate submit 42
```

Pi must retain its original model, runtime and endpoint. Preparation preserves the predecessor's files and failed outcome.
Active, completed, external, published and cross-donor sources are excluded.
Update the owner's pinned coordinator before submission.
`pause`, `resume`, `renew` and `release` change your reservation. Other requests use
`request ISSUE --file FILE`; the accepted schema
is defined by [RequestData](https://github.com/obselate/tokate/blob/main/src/Contributions/RequestData.gs).

After acceptance and evidence backup, you may explicitly delete a completed run.
This prevents later amendment from that run. Uninstalling Tokate preserves saved work.
