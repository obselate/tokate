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
curl -qfsSL https://tokate.dev/install.sh | sh
gh auth login
tokate doctor
```

- **Owners:** [Set up the repository, approve tasks and review donations](docs/owners.md).

  ```sh
  tokate init OWNER/REPO
  tokate init OWNER/REPO --yes
  gh pr merge tokate-setup -R OWNER/REPO
  tokate approve OWNER/REPO#42
  tokate access grant LOGIN OWNER/REPO#42
  tokate checks OWNER/REPO#PR
  gh pr ready PR -R OWNER/REPO
  gh pr merge PR -R OWNER/REPO
  ```

- **Donors:** [Choose a tool, claim an issue and donate work](docs/donors.md).

  ```sh
  tokate work OWNER/REPO#42 --harness HARNESS --model MODEL --effort EFFORT --time 1h
  tokate submit OWNER/REPO#42
  ```

  Gratis work on a repository without a Tokate policy:

  ```sh
  tokate work OWNER/REPO --harness HARNESS --model MODEL --effort EFFORT --time 1h --total 1h --yes
  ```

- **Existing work:** [Recover a run or update a PR](docs/recovery.md).

  ```sh
  tokate status
  tokate status OWNER/REPO#42
  tokate amend OWNER/REPO#42
  tokate amend OWNER/REPO#42 --time 5m --tools TOOLS_FILE --summary SUMMARY_FILE
  tokate submit OWNER/REPO#42
  ```

- **Before running:** [Understand data access and isolation](docs/security.md).

  ```sh
  tokate doctor repo OWNER/REPO
  tokate doctor HARNESS
  ```

- **Source builders:** [Build, test and package Tokate](docs/development.md).

  ```sh
  git clone https://github.com/obselate/tokate.git
  cd tokate
  bash scripts/build.sh
  bash scripts/verify.sh
  ```

[Website](https://tokate.dev/) · [Releases](https://github.com/obselate/tokate/releases) · [Issues](https://github.com/obselate/tokate/issues) · [MIT license](LICENSE)
