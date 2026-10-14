# Nix and NixOS

Use Nix to install Tokate on x86_64 Linux. Nix owns upgrades, rollback and removal.

1. Install [Nix](https://nix.dev/install-nix).
2. Enable commands and flakes in `~/.config/nix/nix.conf`.

   ```ini
   experimental-features = nix-command flakes
   ```

3. On NixOS, enable the same features with the `nix.settings.experimental-features` system option.

4. Install Tokate.

   ```sh
   nix profile add github:obselate/tokate
   ```

5. Check the base tools.

   ```sh
   tokate doctor external
   ```

6. Install a harness. For Codex:

   ```sh
   nix profile add nixpkgs#codex
   ```

7. Check Codex without inference.

   ```sh
   tokate doctor managed codex
   ```

8. For Pi, install its stable flake.

   ```sh
   nix profile add github:earendil-works/pi/stable
   ```

9. Check Pi without inference.

   ```sh
   tokate doctor managed pi
   ```

10. Follow the [donor guide](donors.md) to configure the model and start work.

| Installation choice | Setting |
| --- | --- |
| Existing NixOS flake | Add `inputs.tokate.url = "github:obselate/tokate"`. |
| NixOS package list | Add `inputs.tokate.packages.x86_64-linux.default` to `environment.systemPackages`. |
| Custom profile | Put its `bin` directory on `PATH`, or use an absolute `--harness-path`. |
| Pi Node runtime | Pi uses Node from its package closure. Use `--node` to select another runtime. |
| Runtime location | Keep selected runtimes outside the checkout. |
| System configuration | Tokate does not change it. |

## Build from source

1. Open a terminal at the repository root.
2. Build the package.

   ```sh
   nix build
   ```

3. Check the built version.

   ```sh
   ./result/bin/tokate --version
   ```

4. After a NuGet dependency change, build the dependency fetcher.

   ```sh
   nix build .#default.fetch-deps
   ```

5. Regenerate the dependency hashes.

   ```sh
   ./result nix/deps.json
   ```

6. Rebuild the package.

   ```sh
   nix build
   ```

| Verification requirement | Action |
| --- | --- |
| Compound check command | Declare its tools with `writeShellApplication.runtimeInputs`. |
| Runtime dependencies | Verification mounts the selected executable's declared closure and baseline tools. |
| Other files | Unrelated store paths and home files remain unavailable. |
| Missing closure | Restore the selected profile. Saved work is kept. |

## If something fails

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `Nix manages these prerequisites. Add git, gh, util-linux, coreutils and findutils to your Nix configuration or profile, then rerun doctor.` | `nix profile add nixpkgs#git nixpkgs#gh nixpkgs#util-linux nixpkgs#coreutils nixpkgs#findutils` |
| `The selected Nix runtime closure is unavailable. Restore its profile before retrying.` | `nix profile rollback` |
| `Nix runtimes must be selected outside the checkout.` | `tokate doctor codex --harness-path /absolute/profile/bin/codex` |

Use [Linux security](linux-security.md) for namespace failures. Use [recovery](recovery.md) for saved-run failures.
