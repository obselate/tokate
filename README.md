[![Tokate: Give your inference a purpose. Painted hands cradle a sun above a Renaissance landscape.](site/assets/social-card.jpg)](https://tokate.dev/)

# Tokate

**toh-KAH-teh**. Put your spare AI usage to work for open source.

An owner approves an issue. A donor runs it with their own accounts and tools.
Tokate verifies the result and opens a draft PR for owner review.

## Install

```sh
curl -qfsSL https://tokate.dev/install.sh | sh
```

Or give this to your coding agent:

```text
Read https://raw.githubusercontent.com/obselate/tokate/main/AGENTS.md. Install Tokate and its dependencies with the steps in "Install Tokate and its dependencies", then help me use Tokate as an owner or donor.
```

Open a new terminal if prompted. Use `tokate update` to update or `tokate uninstall`
to remove the installation while keeping saved work.

Current main supports **Linux x86_64 with glibc 2.34+ or Alpine 3.24, and public GitHub repositories**.
Windows, macOS and ARM64 are not supported. See [Nix](docs/nix.md) and
[Alpine](docs/alpine.md) for distribution setup. Managed donations use
native Codex with a ChatGPT login, native Claude Code with a personal Pro/Max login,
Pi with a configured local model endpoint, or OMP with its configured providers.
Owners need neither harness nor an AI subscription.
See [agent installation steps](AGENTS.md#install-tokate-and-its-dependencies) for system packages, GitHub login and harness checks.

## Start here

- **Owners:** [Set up the repository, approve tasks and review donations](docs/owners.md).
- **Donors:** [Choose a tool, claim an issue and donate work](docs/donors.md).
- **Existing work:** [Recover a run or update a PR](docs/recovery.md).
- **Before running:** [Understand data access and isolation](docs/security.md).
- **Source builders:** [Build, test and package Tokate](docs/development.md).

Use plain CLI commands with flags or the GUI. Bare `tokate` prints help.
Commands never prompt. A missing choice fails with `invalid_arguments` and names the required flag.
`tokate work OWNER/REPO --yes` runs approved issues until stopped. Add `--total` to cap the session.
Use `tokate work OWNER/REPO stop --yes` to stop. Bare `tokate work` uses the local GitHub remote.
For one issue, use `tokate work 42 NAME --time 1h` in a checkout or `tokate work OWNER/REPO#42 NAME --time 1h` elsewhere. Supply a saved profile as `NAME` or use tool flags. A repository link selects the loop. An issue link names one issue.
See the [positional arguments guide](docs/arguments.md) for references and command forms.
Use `tokate help COMMAND` for exact options and `--json` for structured results.
Init requires policy choices as flags. Add `--yes` to apply its previewed GitHub Actions and branch protection changes.
Approve existing issues with `tokate approve 42`. Create issues with `gh issue create` or the GUI.
Doctor previews installations with `--fix`, applies them with `--fix --yes`, and accepts `--harness-path FILE` for an existing harness.
Save donor choices with `tokate defaults set NAME --harness HARNESS --model MODEL --effort EFFORT`.

[Website](https://tokate.dev/) · [Releases](https://github.com/obselate/tokate/releases) · [Issues](https://github.com/obselate/tokate/issues) · [MIT license](LICENSE)
