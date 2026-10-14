# Alpine Linux

Use the `linux-musl-x64` release on Alpine 3.24 x86_64. Tokate does not need an installed .NET runtime.

1. Install the installer tools as an administrator.

   ```sh
   doas apk add curl tar coreutils
   ```

2. Install Tokate.

   ```sh
   curl -qfsSL https://tokate.dev/install.sh | sh
   ```

3. Check the base tools and install missing packages.

   ```sh
   tokate doctor external --fix
   ```

4. Check your harness. For Codex:

   ```sh
   tokate doctor codex --fix
   ```

5. For Pi, install Node and npm first.

   ```sh
   doas apk add nodejs npm
   ```

6. Install and check Pi.

   ```sh
   tokate doctor pi --fix
   ```

7. Follow the [donor guide](donors.md) to configure the model and start work.

| Setup item | Behavior |
| --- | --- |
| Release selection | The installer detects the musl loader and selects `linux-musl-x64`. |
| Checksum | The installer checks the archive before replacing Tokate. |
| Package installation | Doctor lists the required `apk` packages and asks before installation. |
| Administrator command | Doctor uses `doas` or `sudo` for ordinary users. Run `apk` directly as root if neither is installed. |
| GNU tools | coreutils and findutils supply options missing from BusyBox applets. |
| Process tools | util-linux-misc and setpriv supply the required process and isolation tools. |
| Pi | Pi needs Bash and an existing Node runtime. The official Pi installer manages Pi. |
| Custom paths | Use absolute `--harness-path`, `--pi-root` and `--node` paths. |
| Namespaces | Tokate does not change user namespace policy. See [Linux security](linux-security.md). |

## If something fails

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `Install curl first.` | `doas apk add curl` |
| `Install tar first.` | `doas apk add tar` |
| `Install sha256sum first.` | `doas apk add coreutils` |
| `sudo or doas was not found. Install the listed packages with an administrator, then rerun doctor.` | As root: `apk add git github-cli curl tar coreutils findutils util-linux-misc setpriv` |
| `Install or repair the tools needed for this command, then run the relevant tokate doctor scope.` | `tokate doctor codex --fix` |

Use [recovery](recovery.md) for saved-run failures.
