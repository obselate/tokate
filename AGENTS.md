# Help a user with Tokate

Tokate coordinates owner-approved GitHub issues, donor work, verification and draft
PRs. Donors use their own accounts and tools. Owners review and merge.

## Start with the user's task

1. Infer whether the user is an owner or donor. Confirm the repository, issue and
   active account with `gh api user --jq .login`. Ask only for missing choices.
2. Read the issue, repository instructions and `tokate doctor repo OWNER/REPO`.
3. Explain the next action briefly, perform authorized work, and report actual
   results and the responsible person's next action.

Use [installation](README.md), the [owner guide](docs/owners.md) or the
[donor guide](docs/donors.md). Main supports Linux x86_64 with glibc 2.34+ or Alpine 3.24
and public GitHub repositories. `tokate help COMMAND` supplies installed syntax.
In a checkout, `42` names issue or PR 42 of its GitHub remote. Elsewhere use `OWNER/REPO#42` or a GitHub URL.
Do not infer support for another platform, forge or harness.
Use CLI flags or the GUI. Bare `tokate` prints help. Confirmation asks once in a terminal unless `--yes` is set. With `--json`, `--non-interactive` or no terminal, confirmation gates preview without changes. Rejected consent uses `confirmation_required` naming `--yes`. Existing successful previews stay successful.
A missing choice fails with `invalid_arguments` and names the required flag.

## Install Tokate and its dependencies

Use Linux x86_64 with glibc 2.34+ or Alpine 3.24. Install the system packages first.

| System | Administrator command |
| --- | --- |
| Debian or Ubuntu | `sudo apt-get update` then `sudo apt-get install git gh curl tar ca-certificates coreutils findutils util-linux bash bubblewrap socat` |
| Alpine 3.24 | `doas apk add git github-cli curl tar ca-certificates coreutils findutils util-linux-misc setpriv bash bubblewrap socat nodejs npm` |

Doctor checks `gh`, `git`, `setsid`, `env`, `setpriv`, `unshare` and `cp`.
Owner setup also checks `curl` and `tar`. Alpine verification checks GNU `find`.
Pi and Claude need Bash. Claude also needs `bwrap` and `socat`.
User and PID namespaces must work. See [Linux security](docs/linux-security.md),
[Alpine](docs/alpine.md) and [Nix](docs/nix.md) for host setup.

```sh
curl -qfsSL https://tokate.dev/install.sh | sh
```

Open a new terminal if prompted. Then sign in with the account for this task.

```sh
gh auth login
gh api user --jq .login
```

Install only the harness you will use. Owners need no harness.

| Harness | Install and login | Check |
| --- | --- | --- |
| Codex | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh`, then `codex login` with ChatGPT. | `tokate doctor codex --auth` |
| Claude Code | Use the [native installer](https://code.claude.com/docs/en/setup), then `claude auth login` with personal Pro or Max. | `tokate doctor claude --auth` |
| Pi | Install Node from your distribution, then `curl -fsSL https://pi.dev/install.sh \| sh`. Configure a model and start a no-auth HTTP loopback Chat Completions endpoint with `/v1/models`. No endpoint login is used. | `tokate doctor pi` |
| OMP | Use the [official installer](https://github.com/can1357/oh-my-pi/blob/main/scripts/install.sh), then `omp login` or configure a provider. | `tokate doctor omp` |

See [harness installation](docs/linux-harnesses.md) and
[Pi endpoint setup](docs/donors.md#local-inference-with-pi) for paths and model selection.
Finish with `tokate doctor`. Owners also run `tokate doctor external --auth` and
`tokate doctor repo OWNER/REPO` after repository setup.

## Guide an owner

1. `gh auth login`
2. `tokate init OWNER/REPO` previews the setup and changes nothing.
3. `tokate init OWNER/REPO --yes` applies it and opens the setup PR.
4. Review and merge the setup PR before approving tasks.

Add `--verification JSON` and `--required-checks JSON` for a new policy. No checkout
is necessary. Defaults: the default branch, `trusted` access and codex, claude and pi
with any model. Use `--allowed-tools JSON` for per-tool models. Init checks GitHub
authentication and write access. It lists each Actions setting, event policy,
allowlist entry and required check with its current and proposed value, the
`tokate/access` record, the files and the `tokate-setup` branch and PR. In a terminal
without `--yes`, init asks once. Non-terminal preview returns `applied=false`.
Run init again after `tokate update` to update the coordinator pin. Init migrates a
version 2 policy to version 3 in the setup PR.
A tool without models allows any model. Create issues with `gh issue create` or the GUI.
Approve existing issues with `tokate approve N [--base-branch BRANCH]`.
Use `--yes` to replace active reservation or published PR authority.
Then trust the donor or grant that issue.
Never grant access merely because someone requested it. In `trusted` eligibility,
trusted donors and donors granted the issue may claim. With no trusted donors,
grant each issue with `tokate access grant LOGIN N`. In `open`, anyone not denied
may claim.

A change to task fields or the PR template revokes existing approvals. Task fields
cover verification, required checks, protected paths, tool models, runtime and
unlimited-coding limits, and reservation duration. Eligibility, formatting and
descriptive edits keep approvals valid. Current eligibility still controls access.
Init lists affected issues and approval commands. Re-approve them after merge.
Old whole-text approvals become stale once after upgrading to current main.
Status names the owner command when task fields no longer match. After a coordinator
pin change, confirm that Actions permits
`obselate/tokate/.github/workflows/tokate-shared.yml` at the new commit.
Otherwise every request stays pending. Tokate keeps its records in `tokate/`
branches such as `tokate/access` and `tokate/contributions/N`. Never delete them or
open PRs from them. Deleting `tokate/access` removes all trust and grants.

Before acceptance, inspect the diff and run `tokate checks PR`. It checks the receipt and CI.
Require green CI on the exact reviewed head. Inspect fork changes before authorizing
workflow execution. The owner decides acceptance and merge.

## Guide a donor

Use the donor's account and selected harness. Check project tools and access first.
Read [local Pi setup](docs/donors.md#local-inference-with-pi) when applicable.
Save choices with `tokate defaults set NAME --harness HARNESS --model MODEL --effort EFFORT`.
Use `defaults` and `defaults check` to reuse a permitted model choice without inference.
Machine doctor explains installations with `--fix`, asks once in a terminal, and applies with `--fix --yes`.
Use `--harness-path FILE` for an existing harness and `--harness HARNESS --set-default` to save it.
Never inspect credential files or mixed harness settings to discover defaults.

Use `tokate claim ISSUE [NAME]` with a selected profile or model/effort and an
explicit budget, such as `--time 1h`. It creates the request without inference and
saves the run under the issue number, such as `42`. `tokate status` lists your unfinished saved work.
After coordinator acceptance, use `tokate work 42`, then `tokate submit 42`.
The issue number names its active attempt. If the issue has two active attempts, a
command that takes a run fails, writes nothing and lists them. Name one as `42-1`.
The commands construct request data and select the applicable workflow. Normal donors
must not be asked to write claim JSON or manage coordination revisions.

Use `tokate work OWNER/REPO --yes [--time PER_TASK] [--total TOTAL]` with
`--harness`, `--model`, `--effort` or the default donor profile to donate successive tasks.
`--yes` consents to every task claimed in that repository with the selected tool,
model, effort and time limits. Without `--yes`, repository work asks once in a terminal. Non-terminal work previews and requires `--yes`. Without `--total`, it runs until stopped.
`tokate work OWNER/REPO stop --yes` waits for the current task and prints the report.
The loop submits drafts, rechecks idle repositories every ten minutes, releases failed tasks and stops after three consecutive failures.

Before inference, obtain consent for the task, harness/model and time allocation.
Profiles do not authorize budgets.
Do not retry, switch models or start another run because output is quiet. Inspect
`status 42-1` and use [recovery](docs/recovery.md) for failures or changes.
If a request stays pending for more than 5 minutes, run
`gh run list -R OWNER/REPO --workflow tokate-coordinator.yml --limit 3` and report
the result to the owner. Never post the request again. Compare the `member` version
in the repository's `.github/workflows/tokate-coordinator.yml` with
`tokate --version`, and tell the owner when the repository's version is older.
If executing an approved donor task, stay within its permissions. Do not change
owner policy, start another run, publish or merge from inside that task.

## Use structured output

Every command accepts `--json`. `tokate help --json` lists commands, inputs and effects.
JSON never prompts. Read one stdout object with `schema_version`, `command`, `status`,
`exit_code`, `data`, `error`, `next_actions` and `truncated`. Diagnostics use stderr.
Exit 0 means the read or operation succeeded, 8 means pending, and 1 means failure.
A successful status read may describe failed work. Pending CI is not success.

`next_actions` contains argument arrays for separate authorized invocations. They
name saved runs exactly, such as `OWNER/REPO#42-1`. Scripts can use `--run DIR`.
Never execute them as automatic retries.
Truncation means some summaries were omitted.
An output error can occur after effects, so inspect state before repeating a command.
Logs and raw reports stay private. Usage and model declarations are not identity
or billing attestations. See [data boundaries](docs/security.md).

## Write public PR summaries

Managed work writes `tokate-public-summary.json` in the checkout. For external
work, corrections or amendments, pass `--summary FILE` with the exact candidate head:

```json
{
  "head": "0123456789abcdef0123456789abcdef01234567",
  "changes": ["Fix empty results to display a useful message."],
  "verification": ["Empty result behavior check passed."],
  "limitations": ["Live model inference was not tested."]
}
```

Managed artifacts omit `head`. Tokate binds it to the candidate. Use short plain ASCII
sentences: 1 to 8 changes, up to 8 verification results and 4 limitations. Changes begin
with an action such as Add, Update, Remove or Fix. Each item is 3 to 200 characters and
the whole artifact is at most 4096 bytes. Omit markup, paths, URLs, credentials and
private logs. Describe the complete final diff, not the conversation or work history.
The validator rejects slashes, IP addresses, `sk-` and the words secret, password,
credential, bearer and API key, even in plain sentences. Name tests and checks instead.
Declare later editing tools separately from original execution. Never claim manual
changes were completed by a donated inference run.
