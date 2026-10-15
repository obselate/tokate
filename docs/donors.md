# Donate work

Use your GitHub account and coding tool to work on an approved issue. Current main runs your tool, checks the result and requests a draft PR.

## Set up

1. Use Linux x86_64 with glibc 2.34+ or [Alpine 3.24](alpine.md).
2. Install Tokate.

   ```sh
   curl -qfsSL https://tokate.dev/install.sh | sh
   ```

3. Sign in to GitHub.

   ```sh
   gh auth login
   ```

4. Check your coding tool.

   ```sh
   tokate doctor codex
   ```

5. Install missing tools when doctor reports them.

   ```sh
   tokate doctor codex --fix --yes
   ```

6. Sign in to the coding tool before you start a donation.
7. Install the project's toolchain on your machine. Tokate needs it to run the owner's verification commands.
8. Keep harness installations and saved runs outside `/tmp` and the project checkout.
9. Read the [security guide](security.md) before you start.

| Coding tool | Check | Account or runtime |
| --- | --- | --- |
| Codex | `tokate doctor codex --auth` | Native Codex with your ChatGPT login. Use `codex login` to sign in. |
| Claude Code | `tokate doctor claude --auth` | Native Claude Code with your personal Pro or Max login. Its sandbox needs bubblewrap and socat. |
| Pi | `tokate doctor pi` | Pi, Node and your configured local model server. |
| OMP | `tokate doctor omp` | Your installed OMP and its configured providers. Use `omp models` to list models. |

Use [Linux harness installations](linux-harnesses.md) for custom paths. Use [Nix setup](nix.md) for a Nix installation.

## Start a donation

1. Open a terminal in the project checkout and choose an allowed harness, model and effort.
2. Start issue 42 with an explicit total budget and verification reserve.

   ```sh
   tokate work 42 --harness codex --model MODEL --effort EFFORT --time 1h --verify-time 20m
   ```

   Or save these choices with `tokate defaults set NAME --harness codex --model MODEL --effort EFFORT`
   and use `tokate work 42 NAME --time 1h --verify-time 20m`.
3. Keep the printed run name, such as `42`. Wait for coding and verification.
4. Submit the saved run.

   ```sh
   tokate submit 42
   ```

5. If submission is pending, inspect `tokate status 42-1` before repeating submit.

Use CLI flags or the GUI. Claim and work show the task, tool, model, effort and budget and ask once in a terminal unless `--yes` is set. Missing choices fail with
`invalid_arguments` and name the required flag. Bare `tokate` prints help.
Outside a checkout, use `tokate work OWNER/REPO#42` for one issue.
Use `tokate claim 42 NAME --time 1h` to reserve without inference.
Doctor explains installations with `--fix`, asks once in a terminal, applies with `--fix --yes`, and
accepts `--harness-path FILE` for an existing installation.
Use `tokate doctor --harness codex --harness-path FILE --set-default` to save the harness.

| During the run | Result |
| --- | --- |
| Claim request | Tokate waits for coordinator acceptance. A pending request is not a reservation. |
| Preparation | Tokate prepares separate coding and verification checkouts. |
| Coding | Your selected harness uses your configured tools and subagents. |
| Verification | Tokate runs the owner's checks independently. Your machine must have the required toolchain. |
| Time limit | `--time` covers coding and verification. It does not cap tokens or provider charges. |
| Network | The harness, its tools and verification commands have network access. |
| Failure | Tokate saves the run. It does not restart failed work automatically. |
| Submission | Tokate pushes saved work and requests a draft PR. It discovers or creates your fork. |
| Review | The owner reviews and merges the PR. |

## Work until stopped

```sh
tokate work OWNER/REPO --yes
tokate work OWNER/REPO stop --yes
```

Use the default donor profile or override it with `--harness`, `--model` and `--effort`.
Save one with `tokate defaults set NAME --harness codex --model MODEL --effort high`,
then `tokate defaults use NAME`. Check it with `tokate defaults check OWNER/REPO NAME`.
Repository links, such as release or tree links, select the loop.
`--time` covers coding and verification per task, defaulting to the lower of one hour
and the owner limit. Without `--total`, it runs until stopped. A task starts only
while `--time` fits in the remaining total. Claim and submission waits can run past it.
`--yes` consents to every task claimed with the selected repository, harness, model, effort and budgets.
Repository work and stop ask once in a terminal unless `--yes` is set. With `--json`, `--non-interactive` or no terminal, they preview without changes and fail with `confirmation_required` naming `--yes`.
Approved issues are selected oldest first across pages. Reserved, stale, inaccessible,
dependency-blocked and already attempted issues are skipped. Each task uses claim, work and submit.
Failed tasks release reservations. Three consecutive failures stop the loop. Idle rechecks occur every ten minutes.
Stop waits for the current task and prints wall time, submitted, skipped and failed tasks, PR URLs and token totals.

### Gratis selection

Repositories without `.github/tokate.json` use gratis mode.

```sh
# Gratis free selection: let the harness choose tasks for one hour
tokate work OWNER/REPO --time 1h --total 1h --yes

# Gratis one issue: work issue 42, then publish
tokate work OWNER/REPO#42 --time 1h --yes

# Gratis issue list: work and publish each issue in this order
tokate work OWNER/REPO#12,15,40 --time 1h --yes

# Gratis review: stop each task before publication
tokate work OWNER/REPO#42 --time 1h --review --yes
# Preview the exact PR title and body, then publish
tokate submit OWNER/REPO#42 --json
tokate submit OWNER/REPO#42 --yes
```

Free selection always lets the harness choose, with or without guidance.
One issue is a list of one. All listed issues must be open, unlocked and not PRs.
Tokate checks the full list before consent. Consent names the list.
After consent, each task publishes without another prompt.
With `--review`, each task stops before publication and prints its `tokate submit` command.
In a terminal, submit previews the exact text and asks once.
With `--json`, `--non-interactive` or no terminal, submit previews without changes.
Use `--yes` to publish the reviewed text.
Free selection stops on refusal, no PR, the total budget, a stop request or three consecutive failures.
A repository with a policy keeps the approved-issue flow and rejects issue lists and `--review`.
In gratis mode, the harness can write `tokate-title.txt` in the checkout root to
set the commit and PR title. Use one plain ASCII line of at most 100 characters.

## Use a script

1. Replace `N` with the issue number, `M` with an allowed model and `E` with its allowed effort.
2. Reserve the issue without inference.

   ```sh
   tokate claim N --harness codex --model M --effort E --time 1h
   ```

3. Wait for coordinator acceptance.
4. Work on the saved run printed by claim.

   ```sh
   tokate work N
   ```

5. Submit that run after successful verification.

   ```sh
   tokate submit N
   ```

Use `--verify-time 20m` to reserve 20 minutes within the total time. Without `--verify-time`, coding can use the total time and verification gets only the time coding leaves. Use [positional arguments](arguments.md) for issue and run references.

## Save a profile

1. Save an allowed tool, model and effort.

   ```sh
   tokate defaults set my-codex --harness codex --model MODEL --effort EFFORT
   ```

2. Check the saved profile.

   ```sh
   tokate defaults show my-codex
   ```

3. Use it for a donation.

   ```sh
   tokate work 42 my-codex --time 1h
   ```

| Command | Action |
| --- | --- |
| `tokate defaults` | List profiles. |
| `tokate defaults use my-codex` | Make the profile your default. |
| `tokate doctor codex --set-default` | Save the named installed harness as the default. |
| `tokate defaults check OWNER/REPO my-codex` | Check a permitted model without inference. |

Profiles save tool settings, not time budgets. The owner must allow your tool, provider, model and effort.

## Local inference with Pi

1. Install Pi and Node with [Pi's instructions](https://pi.dev/).
2. Configure your model in Pi.
3. Start a no-auth HTTP loopback Chat Completions server. Tokate does not start it.
4. Make sure `/v1/models` lists the exact model ID.
5. Ask the owner to allow `pi/local-chat-completions`, that model and its reasoning level.
6. Check Pi.

   ```sh
   tokate doctor pi
   ```

7. Save the local profile.

   ```sh
   tokate defaults set local --harness pi --model MODEL_ID \
     --effort high --endpoint http://127.0.0.1:8080/v1
   ```

8. Check the profile under owner policy.

   ```sh
   tokate defaults check OWNER/REPO local
   ```

9. Start the donation.

   ```sh
   tokate work OWNER/REPO#42 local
   ```

| Pi setting | Requirement |
| --- | --- |
| Effort | Use a supported reasoning level. Use `absent` only for a model without reasoning. |
| Endpoint | Required. Pass `--endpoint` or use a saved profile. Use `http://127.0.0.1:PORT/v1` or `http://[::1]:PORT/v1`. `localhost` and remote endpoints are rejected. Authentication is not supported. |
| Model limits | Pi SDK metadata must provide valid context and output limits. |
| Custom installation | Supply absolute `--pi-root` and `--node` paths. `--pi-root` names the installed `node_modules` directory. |

## Use OMP

1. Install OMP with its [official installer](https://github.com/can1357/oh-my-pi).
2. Sign in or configure a provider inside OMP.
3. Check OMP without inference.

   ```sh
   tokate doctor omp
   ```

4. Save an owner-allowed provider, model and effort.

   ```sh
   tokate defaults set omp --harness omp --provider PROVIDER \
     --model MODEL_ID --effort EFFORT
   ```

5. Start a donation with that profile.

   ```sh
   tokate work OWNER/REPO#42 omp
   ```

| OMP behavior | Result |
| --- | --- |
| Tools and extensions | Tokate uses your normal OMP setup and approves tool calls automatically. |
| Isolation | OMP has no sandbox. |
| Credentials | Tokate does not read OMP credentials or forward API key variables. Configure the provider inside OMP. |
| Sessions | Tokate saves no OMP session. |
| Provider error | Work stops and prints OMP's reason. Tokate does not retry it. |
| Charges | Charges are unknown to Tokate. |

## Use an owner-declared command

The owner can allow a `command` tool. It runs the owner's command from the policy
on your computer, without a sandbox. Read the command in `tokate doctor repo OWNER/REPO`
or in the `defaults check --json` output before you claim. Confirmation screens show the
command. Work prints it before it starts. `work OWNER/REPO` refuses a claim when
the owner changed the command after your consent.

```sh
tokate claim OWNER/REPO#42 --harness command --model MODEL --effort EFFORT --time 1h
```

Add `--provider PROVIDER` when the policy allows more than one command tool.

## Check or control a run

1. List your unfinished saved runs.

   ```sh
   tokate status
   ```

2. Inspect the exact attempt.

   ```sh
   tokate status 42-1
   ```

3. Use the command for the required reservation change.

| Command | Action |
| --- | --- |
| `tokate pause 42` | Pause your reservation. |
| `tokate resume 42` | Resume a paused reservation without inference. |
| `tokate renew 42` | Renew before the reservation expires. |
| `tokate release 42` | Release the reservation for other donors. |
| `tokate work 42` | Start work on an accepted saved claim. |
| `tokate checks 10 --watch` | Watch PR 10 checks. The number is a PR number. |

Keep the saved run directory. Use [recovery](recovery.md) for stopped work, external work and PR changes.

## If something fails

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `Install or repair the tools needed for this command, then run the relevant tokate doctor scope.` | `tokate doctor codex --fix --yes` |
| `OMP lists no models. Sign in with omp login or configure a provider.` | `omp login` |

For other failures, use the exact-message tables in [recovery](recovery.md) and [Linux security](linux-security.md).
