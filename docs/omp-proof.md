# Native OMP proof

Run the managed OMP workflow against a real installed OMP executable:

```sh
python3 scripts/omp-proof.py --omp ~/.local/bin/omp
```

The proof installs nothing and needs bubblewrap. It runs without network access,
uses a temporary home with synthetic configuration and a local synthetic provider,
and spends no credentials or inference. `--case NAME` runs one case.

| Case | Checks |
| --- | --- |
| `stop` | Doctor, claim, work, verification, usage and version evidence. |
| `tools` | Native write, read and bash tools edit the checkout. |
| `failed` | A provider refusal fails the run and reports its reason. |
| `timeout` | The budget stops OMP and its descendants. |
| `cancel` | Interrupting work stops OMP and its descendants. |

The final JSON record names the tested version. CI runs the proof against the
latest official release. It does not attest remote model identity, provider
billing or account entitlement.
