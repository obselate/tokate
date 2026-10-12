# Accept donations

Owners need Git, the GitHub CLI, repository write access and Tokate. A coding
harness or AI subscription is not required. Use public GitHub repositories.

## Set up once

1. Run `gh auth login`, then `tokate doctor owner --auth`.
2. Run `tokate init OWNER/REPO` inside your repository checkout, or pass `--path`
   to one. Setup starts from the policy on your default branch on GitHub.
3. Review the GitHub Actions settings before answering project questions. If the
   event policy is missing, setup offers to create the active "Tokate coordinator
   events" policy for the coordinator workflow, allowing `issue_comment`,
   `pull_request_target` and `workflow_call`. If PR creation is disabled, setup
   offers to enable "Allow GitHub Actions to create and approve pull requests"
   while keeping the default workflow permissions. Confirm the displayed changes
   to apply them. With `--non-interactive`, missing settings cause failure before
   any writes. Existing blocking event or actor policies require owner review in
   Settings > Actions > Policies, including access for external actors.
4. Choose contributor access, model restrictions, verification commands, required
   CI checks and time limits. New setup uses Trusted access. Time prompts use
   `--max-time` and `--reservation-time` units, such as `1h` or `30m`, and show
   defaults in those units. The model checklist searches as you type. Space
   selects, Enter accepts, and F2 adds a model absent from local discovery.
   Suggestions are not selected for you. A local model needs its exact ID and
   supported reasoning levels. Use `absent` only for models without reasoning.
   Availability remains unknown.
5. Select Codex or Claude Code (Subscription), Pi (Local), or their combination
   at the allowed-tools prompt. Scripts can use `--allowed-tools codex,pi`.
   Omission preserves existing tools. New noninteractive setup defaults to Codex.
   OMP requires exact provider pairs, such as
   `--allowed-tools codex/openai,omp/openrouter`. Exact pairs replace the whole
   list. The `codex,claude,pi` shorthand keeps existing OMP pairs. OMP runs with
   the donor's configuration and no additional isolation.
6. Review the generated diff. Setup uses a matching stable release and writes
   `.github/tokate.json` and a small, immutable shared-workflow entry directly.
   Existing configuration is preserved. The coordinator does not execute donor
   code. It can close PRs without current owner authorization. Review that
   behavior before enabling the workflow.
7. Commit and push the policy and workflow to the default branch before approving
   work. Keep fork CI read-only, without secrets, and require its checks in branch
   protection. Use `tokate init --help` for scripted setup and policy options.
   Optional root `DECREE.md` contains task instructions captured at approval.
   It cannot expand permissions or donor budgets. Use `protected_paths` to protect
   verification tooling and other authority files beyond Tokate's built-in
   protections.

## Approve an issue and donor

Write a small issue with scope, acceptance criteria and failure cases, then run:

```sh
tokate access init
tokate approve 42
tokate access trust DONOR
```

Tokate keeps its state in `tokate/` branches; do not open or merge pull requests from them.

In a checkout, `42` names issue 42 of its GitHub remote. Elsewhere use `OWNER/REPO#42`.

See the [positional arguments guide](arguments.md) for references and command forms.

Initialize access once. Trust permits future approved tasks. Use `access grant DONOR 42`
for one issue instead. `tokate access` shows requests and trusted donors. Requests grant no access. Open eligibility accepts authenticated,
non-denied donors. Manual eligibility requires an issue grant. Explicit denial
blocks participation in every mode.

Issue, policy or PR-format changes require fresh approval. Revoking donor access
also blocks new work and publication. Share the [donor guide](donors.md) and the
project's build prerequisites.

## Review and merge

```sh
tokate verify 10
tokate checks 10 --watch
```

Inspect the diff before approving a first-time fork workflow. Every required check
must pass on the current PR head. Check scope, acceptance criteria, limitations and
conflicts before merging. Receipts validate recorded authority and commits. They
do not prove model identity, billing or semantic correctness. Tokate leaves final
acceptance and merging to you.

Target movement alone does not fail `checks`. It reports the verified and current
target revisions and GitHub mergeability. Reconcile only when GitHub reports a
conflict or branch protection requires an up-to-date branch. GitHub controls
up-to-date branch and merge queue requirements. The `verify` command and authority
checks are unchanged.

## Update the coordinator

Updating your local CLI does not update the repository's pinned coordinator:

```sh
tokate update
tokate coordinator-setup OWNER/REPO --output tokate-coordinator.yml --yes
```

Review the generated entry and replace the existing coordinator workflow, preserving
necessary customization. Commit it before using features that need the new coordinator,
including readable request comments and continued-run submissions. Do not add a
second coordinator. See [recovery](recovery.md) when existing work needs attention.
