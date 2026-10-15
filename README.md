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

```sh
# Install Tokate, log in to GitHub and check the machine
curl -qfsSL https://tokate.dev/install.sh | sh
gh auth login
tokate doctor
```

- **Owners:** [Set up the repository, approve tasks and review donations](docs/owners.md).

  ```sh
  # Set up once: preview the changes, apply them, then merge the setup PR
  tokate init OWNER/REPO
  tokate init OWNER/REPO --yes
  gh pr merge tokate-setup -R OWNER/REPO

  # Approve an issue for donors
  tokate approve OWNER/REPO#42

  # Optional: let one donor you do not trust yet work that issue
  tokate access grant LOGIN OWNER/REPO#42

  # Check a donated PR, then merge it
  tokate checks OWNER/REPO#PR
  gh pr ready PR -R OWNER/REPO
  gh pr merge PR -R OWNER/REPO
  ```

- **Donors:** [Choose a tool, claim an issue and donate work](docs/donors.md).

  ```sh
  # Work one approved issue, then open its PR
  tokate work OWNER/REPO#42 --harness HARNESS --model MODEL --effort EFFORT --time 1h
  tokate submit OWNER/REPO#42

  # Donate to a repository without a Tokate policy for one hour, or stop early
  tokate work OWNER/REPO --harness HARNESS --model MODEL --effort EFFORT --time 1h --total 1h --yes
  tokate work OWNER/REPO stop
  ```

  Pi also needs `--endpoint http://127.0.0.1:PORT/v1` or a saved profile. See [local inference with Pi](docs/donors.md#local-inference-with-pi).

- **Existing work:** [Recover a run or update a PR](docs/recovery.md).

  ```sh
  # List your saved work, or show one run with its checkout path
  tokate status
  tokate status OWNER/REPO#42

  # Fix a published PR: edit and commit in the checkout, then verify and publish
  tokate amend OWNER/REPO#42 --time 5m
  ```

  Add `--summary FILE` to replace the PR summary. Add `--tools FILE` only when an AI tool made the edits.

- **Before running:** [Understand data access and isolation](docs/security.md).

  ```sh
  # Check a repository's policy and coordinator, and your harness
  tokate doctor repo OWNER/REPO
  tokate doctor HARNESS
  ```

- **Source builders:** [Build, test and package Tokate](docs/development.md).

  ```sh
  # Build and run the fast gate
  git clone https://github.com/obselate/tokate.git
  cd tokate
  bash scripts/build.sh
  bash scripts/verify.sh
  ```

[Website](https://tokate.dev/) · [Releases](https://github.com/obselate/tokate/releases) · [Issues](https://github.com/obselate/tokate/issues) · [MIT license](LICENSE)
