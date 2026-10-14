# Build and verify

Build Tokate from the repository root. The released native CLI does not need .NET or G#.

## Build from source

1. Install the Ubuntu 24.04 build packages.

   ```sh
   sudo apt-get update
   sudo apt-get install --no-install-recommends bash git tar curl ca-certificates clang zlib1g-dev libicu74 libgssapi-krb5-2
   ```

2. Install the exact SDK from `global.json`.

   ```sh
   sdk_setup=$(mktemp)
   curl -fsSL https://dot.net/v1/dotnet-install.sh -o "$sdk_setup"
   bash "$sdk_setup" --jsonfile global.json --install-dir "$HOME/.dotnet" --no-path
   rm "$sdk_setup"
   ```

3. Add the SDK to `PATH`.

   ```sh
   export PATH="$HOME/.dotnet:$PATH"
   ```

4. Build the CLI and test executable.

   ```sh
   bash scripts/build.sh
   ```

5. Check the built version.

   ```sh
   artifacts/linux-x64/tokate --version
   ```

## Prerequisites

| Requirement | Use |
| --- | --- |
| .NET SDK `10.0.401` exactly | `global.json` sets `rollForward` to `disable`. |
| Clang and a native linker | NativeAOT compilation. |
| zlib development headers | NativeAOT linking. Ubuntu package: `zlib1g-dev`. |
| Ubuntu `libicu74` and `libgssapi-krb5-2` | .NET system dependencies. |
| Bash, git, tar and curl | Build, verification, packaging and SDK setup. |
| CA certificates and NuGet network access | First restore of pinned G# SDK and locked packages. |

For other distributions, use the [.NET system dependencies](https://learn.microsoft.com/dotnet/core/install/linux-scripted-manual#dependencies) and [NativeAOT prerequisites](https://learn.microsoft.com/dotnet/core/deploying/native-aot/#prerequisites).

## Verify a change

1. Run the PR fast gate.

   ```sh
   bash scripts/verify.sh
   ```

2. Run the selector for the changed system.

   ```sh
   bash scripts/verify.sh --saved-runs
   bash scripts/verify.sh --pi-runtime
   bash scripts/verify.sh --preparation PendingClaim
   ```

3. Run full validation before a release.

   ```sh
   bash scripts/verify.sh --full
   ```

| Tier | Checks and time |
| --- | --- |
| PR fast gate, no arguments | Builds, then runs 14 end-to-end and security selectors in parallel. Required PR check: `verify`. |
| Selector | Builds, then runs the selected checks. No match is an error. |
| Nightly and pre-release | Full suite and native harness proofs. CI runs nightly on `main`, on manual runs with `full: true`, and on integration pushes. Run `--full` locally before release. |
| Alpine and Nix | Platform build, packaging and runtime proofs. Run nightly, manually, on `main` and integration pushes. PRs run them only for their listed platform inputs. Source-only and docs-only PRs do not run them. These are not required PR checks. |

The fast gate covers `CrossAccountFlow`, `CanonicalSubmit`, `RepositoryDonation`, `VerificationNetwork`, protected paths, `ReceiptEvidence`, `CoordinatorPermissions`, `LabelApprovalPermissions`, `LeaseFencing`, `PublicationRevocation`, `ClaimRecovery`, correction `ProtectedAndExact`, amendment `ReceiptAuthority`, and continuation `ImportBoundary`.

The platform filters are in [Alpine CI](../.github/workflows/alpine.yml) and
[Nix CI](../.github/workflows/nix.yml). Both include SDK, project, lock, installer
and license files. Alpine adds its scripts, packaging and native proof script.
Nix adds its flake, `nix/` files and Nix scripts.

Harness proofs use deterministic local responses and actual harness versions. They do not measure model quality, account entitlement or allowance.

Find selectors in [the test entry point](https://github.com/obselate/tokate/blob/main/tests/Dispatch/Main.gs). CI supports focused selectors and full validation.

## Package

1. Set the product version in `VERSION`.

2. Build the release archive.

   ```sh
   bash scripts/package.sh
   ```

3. Inspect the archive and checksum before publication.

| Target | Setting or output |
| --- | --- |
| Linux x86_64 | glibc 2.34 or newer. Output: `artifacts/linux-x64`. |
| Alpine 3.24 | Set `TOKATE_RUNTIME_IDENTIFIER=linux-musl-x64` for build, verify and package scripts. |
| Musl tests | `artifacts/tests-musl/tokate-tests`. Set `TOKATE_BINARY` to the musl CLI for direct test runs. |
| Archive | Matching binary, public guides and license notices. |
| Private data | Keep run artifacts, credentials and local engineering instructions out of commits and releases. |

## Source boundaries

| Area | Owns |
| --- | --- |
| `src/Cli` | Argument parsing and presentation. Compose existing operations here. |
| Contributions and policy | Authority and lifecycle rules. |
| Execution | Harness and verification boundaries. |
| Publication | Receipts and pull request writes. |
| GitHub | Transport and remote identity. |

## If something fails

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `No test matched the selected arguments.` | `bash scripts/verify.sh --saved-runs` |
