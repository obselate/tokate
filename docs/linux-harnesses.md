# Linux harness installations

Install a coding tool before you donate work. Tokate itself does not need npm, Bun or Node.

1. Install a harness from its official source in the table below.
2. Sign in or configure its model provider.
3. Check the harness without inference.

   ```sh
   tokate doctor codex
   ```

4. Replace `codex` with `claude`, `pi` or `omp` for another harness.
5. Use `--fix` to install missing prerequisites or select an existing installation.

   ```sh
   tokate doctor codex --fix --yes
   ```

6. Use an absolute path for a custom executable.

   ```sh
   tokate doctor codex --harness-path /opt/codex/bin/codex
   ```

7. Follow the [donor guide](donors.md) to start work.

| Harness | Official installation | Managed work requirements |
| --- | --- | --- |
| Codex | [Native installer](https://chatgpt.com/codex/install.sh) | Native Linux x64 executable and your ChatGPT login. npm and Bun layouts are also supported. |
| Claude Code | [Native setup](https://code.claude.com/docs/en/setup) | Native Linux x64 executable, your personal Pro or Max login, bubblewrap and socat. |
| Pi | [Pi installer](https://pi.dev/install.sh) | Pi SDK, Node and a configured local model endpoint. npm, Bun and Nix layouts are also supported. |
| OMP | [OMP installer](https://github.com/can1357/oh-my-pi/blob/main/scripts/install.sh) | Existing OMP providers and at least one listed model. OMP has no sandbox. |

| Discovery setting | Location |
| --- | --- |
| `--harness-path` | Explicit absolute executable path. Checked first. |
| `PATH` | Trusted executable outside the current checkout. Checked before fallback paths. |
| `CODEX_INSTALL_DIR` | Codex executable directory. Default: `~/.local/bin`. |
| `PI_CODING_AGENT_DIR` | Pi agent directory. Default: `~/.pi/agent`. |
| `PI_INSTALL_DIR` | OMP executable directory. Default fallback: `~/.local/bin/omp`. |
| `NPM_CONFIG_PREFIX` | npm prefix with executables in `bin`. |
| `BUN_INSTALL_BIN` | Bun binary directory. Default fallback: `~/.bun/bin`. |

Tokate skips automatic discovery inside the checkout, including symlinks into it. It does not read shell startup files, `.npmrc`, `bunfig.toml` or credentials to discover paths.

| Additional check | Command |
| --- | --- |
| Codex login | `tokate doctor codex --auth` |
| Claude login | `tokate doctor claude --auth` |
| Custom Claude configuration | `tokate doctor managed claude --claude-profile /absolute/profile` |
| Custom Pi layout | `tokate doctor pi --pi-root /absolute/node_modules --node /absolute/bin/node` |
| Default harness | `tokate doctor codex --set-default` |

Pi's installation metadata must identify the selected launcher. A wrapper needs its matching SDK, not an unrelated global npm package.

## If something fails

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `Install or repair the tools needed for this command, then run the relevant tokate doctor scope.` | `tokate doctor codex --fix --yes` |
| `The selected default harness was not found. Install it first, or supply --harness-path.` | `tokate doctor codex --fix --yes` |
| `Cannot locate the Pi SDK from this launcher. Select its installed node_modules directory with --pi-root.` | `tokate doctor pi --pi-root /absolute/node_modules --node /absolute/bin/node` |
| `OMP lists no models. Sign in with omp login or configure a provider.` | `omp login` |

Use [Linux security](linux-security.md) for namespace failures. Use [Alpine](alpine.md) or [Nix](nix.md) for distribution setup.
