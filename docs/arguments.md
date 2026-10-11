# Positional arguments

Put command targets after the command. Run `tokate help COMMAND` for full syntax.

## References

| Form | Meaning |
| --- | --- |
| `42` | Issue 42 in the checkout's GitHub remote. For `checks` and `verify`, PR 42. |
| `OWNER/REPO#42` | Issue 42 in that repository, or PR 42 for `checks` and `verify`. |
| GitHub URL | An issue, PR or repository URL for a command that accepts that reference. |
| `OWNER/REPO` | Repository target. `tokate work OWNER/REPO` opens its issue chooser. |
| `42-3` | Attempt 3 for issue 42. Use `OWNER/REPO#42-3` to name its repository. |

Repository-scoped commands without an issue or PR operand can take a trailing
`OWNER/REPO`; for example, `tokate access trust LOGIN OWNER/REPO`.

For commands whose target is `RUN`, such as `submit`, `pause` and `recover`, a
bare `42` selects the newest attempt; `42-3` selects attempt 3. If its state does
not fit, the command fails without writing. Use `tokate runs` to inspect attempts;
it works offline.

`status 42` targets issue 42. `checks 42` and `verify 42` target PR 42. If a PR has
one saved run, `checks` uses it; use `42-3` for a specific attempt.

`tokate work 42` continues the newest saved claim only when no new task selection
or budget is given. With a new selection or budget, it starts a new attempt.

## Command positionals

| Command | Positionals |
| --- | --- |
| `work` | `ISSUE [NAME]`, `OWNER/REPO` to choose an issue, or `RUN` |
| `claim` | `ISSUE [NAME]` or `OWNER/REPO` |
| `prepare` | `ISSUE [NAME]`; use `--run DIR` to resume recorded preparation |
| `submit`, `pause`, `resume`, `renew`, `release`, `recover`, `amend`, `external`, `reconcile` | `RUN` |
| `status` | `ISSUE`, `OWNER/REPO` or `RUN` |
| `checks` | `PR` or `RUN` |
| `verify`, `authorize-sync` | `PR` |
| `runs` | Optional `ISSUE` or `OWNER/REPO` |
| `approve`, `revoke`, `request`, `coordination` | `ISSUE` |
| `init`, `policy`, `coordinator-setup`, `revoke-sync`, `admit`, `coordinate` | Optional `OWNER/REPO` |
| `select` | Optional `OWNER/REPO [NAME]` or `NAME` in a checkout |
| `overlaps` | 2 to 16 PR references |
| `access init` | Optional `OWNER/REPO` |
| `access trust`, `untrust`, `deny`, `restore` | `LOGIN [OWNER/REPO]` |
| `access grant`, `remove` | `LOGIN ISSUE` |
| `access check`, `request` | `ISSUE` |
| `access list`, `history` | `[LOGIN] [OWNER/REPO]` |
| `doctor` | `owner [HARNESS]`, `managed [HARNESS]`, `external [HARNESS]` or `HARNESS` (`owner` and `codex` are valid alone) |
| `defaults` | `list`; `set [NAME]`; `use NAME`; `show [NAME]`; `remove [NAME]`; no subcommand also lists saved profiles |
| `help` | Optional `COMMAND` |
| `completion` | `bash`, `zsh` or `fish` |
| `update`, `uninstall`, `claude-capabilities`, `--version` | None |

`--run DIR` names an exact saved directory. JSON `next_actions` use this form.

## Flags and time units

- Exact revisions and file inputs stay attached to the operation: `--commit SHA`,
  `--state SHA`, `--upstream SHA`, `--grant SHA`, `--tools FILE`, `--summary FILE`,
  `--file FILE`, `--event FILE` and `--output FILE`.
- Harness and model settings remain flags because they select execution, not the
  command target: `--harness`, `--model`, `--effort` and `--provider`.
- `--fork LOGIN/REPO` selects a donor fork; `--from-pr N` seeds from another
  donor's last coordinated PR.
- Issue, PR, repository and profile targets are positionals; source modifiers
  stay flags.
- Switches such as `--yes`, `--watch`, `--trust`, `--resume` and `--json` control
  behavior.
- Time flags need a unit: `--time 30m`, `--verify-time 10m`, `--max-time 2h`,
  `--reservation-time 1d` and `--timeout 45s`. Examples use seconds (`s`), minutes
  (`m`), hours (`h`) or days (`d`); command limits still apply.
