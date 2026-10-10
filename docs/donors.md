# Donate work

Use your own GitHub account and coding harness. Tokate needs Linux x86_64,
glibc 2.34+ or [Alpine 3.24](alpine.md), Git, the GitHub CLI and util-linux `setpriv` and `unshare` with working user namespaces.
Project build tools must be accessible from system paths. Keep managed runs and
harness installations outside `/tmp`.

```sh
gh auth login
```

For in-harness guidance, run `sh plugins/install.sh codex` from the release archive
(or choose `claude`, `pi`, `omp` or `hermes`), then restart the harness and invoke its Tokate skill.

Choose an approved, available issue. If access is required, request it and wait
for the owner to grant it:

```sh
tokate access --repo OWNER/REPO --operation request --issue 42 --scope trust
```

## Choose a tool

`tokate doctor --fix` repairs common dependencies and reports installed harnesses.
In a terminal, it lets you choose an installed harness as your default.
Installing a harness requires `--harness codex` or `--harness pi` with `--fix`.
Change the default with `tokate doctor --set-default`. Keep multiple setups with
`defaults set --profile NAME --harness HARNESS`, then switch with
`defaults use --profile NAME`. Model settings can be added later.
Use `--harness-path` for an existing custom installation.
Harness authentication and [host namespace policy](linux-security.md)
remain separate from package installation.

For Codex, use a current native installation with your ChatGPT login:

```sh
codex login
tokate doctor --managed --harness codex --auth
tokate defaults set --model MODEL --effort EFFORT
tokate select --repo OWNER/REPO
```

Select an owner-allowed model and effort. The offline catalog and login check do
not prove account availability or remaining allowance. `defaults list` shows saved
choices. Add `--profile NAME` to keep several choices and select one per donation.
Profiles do not store budgets.

Codex runs unattended, so tools that need approval are refused. Set
`default_tools_approval_mode = "approve"` on MCP servers you trust for donations.

### Claude Code

Choose Claude Code in the donation wizard. It uses your installed native CLI,
existing login, settings and tools. Sign in through Claude Code first with your
personal Pro or Max subscription. `--claude-profile DIR` selects an existing
configuration directory when needed. Claude Code's sandbox needs bubblewrap and
socat; `tokate doctor --fix --harness claude` installs missing packages.

For a saved choice, after native sign-in:

```sh
tokate defaults set --profile claude --harness claude --model MODEL --effort EFFORT
```

Use that profile with the same `claim`, `work` and `submit` commands below. Tokate
never reads or copies its credentials. Login status does not prove model availability.

### Local inference with Pi

Install current Pi and Node using [Pi's official instructions](https://pi.dev/).
Configure the model in Pi and start a no-auth HTTP loopback Chat Completions endpoint.
Tokate does not start a model server. The owner must allow
`pi/local-chat-completions` and your exact model and reasoning level. The guided CLI
offers levels from Pi. Use `absent` only for a model without reasoning.

```sh
tokate defaults set --profile local --harness pi --model 'MODEL_ID' \
  --effort high --endpoint http://127.0.0.1:8080/v1
tokate select --repo OWNER/REPO --profile local
```

Tokate discovers the CLI and Node from supported npm or managed Pi installations.
For a custom layout, supply absolute `--pi-root` and `--node` paths. There is no
`/usr/bin/node` requirement. Pi's nonsecret SDK metadata must supply the configured
context and output limits. The endpoint must advertise the exact model at
`/v1/models`. Missing or incompatible metadata stops before inference. Remote
endpoints, authentication and paid Pi providers are not supported by this route.

### OMP

Install OMP with its [official installer](https://github.com/can1357/oh-my-pi) and
sign in or configure a provider in OMP first. The owner must allow `omp/PROVIDER`
and your exact model and reasoning level. Check without inference, then save a choice:

```sh
tokate doctor --managed --harness omp
tokate defaults set --profile omp --harness omp --provider PROVIDER \
  --model 'MODEL_ID' --effort EFFORT
tokate select --repo OWNER/REPO --profile omp
```

`omp models` lists what your OMP can use. `--provider` can be omitted when the
owner allows one OMP provider. Use `absent` only for a model without reasoning.
Tokate runs your normal OMP CLI unattended with its tools, extensions and stored
login, approves its tool calls automatically and saves no OMP session. It never reads
OMP credentials or forwards API key variables; a provider that needs one must be
configured inside OMP. OMP has no sandbox. A provider error, such as rejected
credentials or exhausted credits, stops the run and `work` prints OMP's reason.
Tokate does not retry it.
Charges are unknown to Tokate.

## Claim, work and submit

In a terminal, start with `tokate work OWNER/REPO`. Choose an available approved
issue, tool and budget. Review the task, model and budget before confirming.

To reserve without starting inference, for example for one hour with 20 minutes
reserved for verification:

```sh
tokate claim https://github.com/OWNER/REPO/issues/42 --profile local \
  --seconds 3600 --verification-reserve 1200
```

Omit `--profile local` to use your default tool choice. Claiming spends no inference.
Tokate posts the request and prints the saved run directory. A pending request is
not a reservation. Wait for coordinator acceptance, then run:

```sh
tokate work --run RUN_DIRECTORY
tokate submit --run RUN_DIRECTORY
```

`work` spends the selected budget and independently verifies completed work.
`submit` requests the draft PR. Tokate discovers or creates your fork. Use `--fork`
only when you need to select one explicitly. You do not need to write request JSON.
After coordinator publication, repeat `submit --run RUN_DIRECTORY` to save the PR locally.

`--seconds` caps coding plus verification time, not tokens or server billing.
The harness, its tools and owner verification always have network access, which
cloud and local model servers both need. Native harness settings control its retries and context handling
within the budget; Tokate never restarts a failed run automatically.
Review [data and isolation limits](security.md).

## Check progress

Bare `tokate` also offers saved contributions. Inspection works offline and requires
explicit selection. For scripts or a custom run path:

```sh
tokate status --run RUN_DIRECTORY
tokate checks --repo OWNER/REPO --pr 10 --watch
```

Follow the reported next action. Quiet output does not justify restarting work.
Keep the saved directory for [recovery and review changes](recovery.md). The owner
reviews and merges.
