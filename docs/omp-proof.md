# Native OMP proof

This proof uses a real installed OMP executable with a local synthetic provider. It installs nothing and uses no credentials or external inference.

## Run the proof

1. Build Tokate with the [development guide](development.md).

2. Check the installed OMP tools.

   ```sh
   tokate doctor omp --json
   ```

3. Run all proof cases.

   ```sh
   python3 scripts/omp-proof.py --omp ~/.local/bin/omp
   ```

4. Use `--case` to run one case.

   ```sh
   python3 scripts/omp-proof.py --omp ~/.local/bin/omp --case tools
   ```

## Evidence

| Case | Checks |
| --- | --- |
| `stop` | Doctor, claim, work, verification, usage and version evidence. |
| `tools` | Native write, read and Bash tools edit the checkout. |
| `failed` | Provider refusal fails the run and reports its reason. |
| `timeout` | The budget stops OMP and its descendants. |
| `cancel` | An interrupt stops OMP and its descendants. |

| Boundary | Result |
| --- | --- |
| Network | Bubblewrap disables external network access. The synthetic provider is local. |
| Configuration | Temporary home with synthetic configuration. |
| Credentials | No credential reaches the synthetic provider. |
| Version | Final JSON record names the tested version. CI uses the latest official release. |
| Not established | Remote model identity, provider billing or account entitlement. |

## If something fails

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `Unknown OMP proof case` | `python3 scripts/omp-proof.py --omp ~/.local/bin/omp --case stop` |
| `The real OMP executable is required; this probe never installs it` | `tokate doctor omp --json` |
| `OMP requested another model` | `python3 scripts/omp-proof.py --omp ~/.local/bin/omp --case stop` |
