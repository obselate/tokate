# Data and isolation

Tokate coordinates GitHub issues and pull requests. Donors keep their accounts, credentials and subscription quotas.

## What Tokate reads

| Data | Use |
| --- | --- |
| GitHub issues, policy and approval state | Check the approved task and publication authority. |
| Repository files and owner instructions | Prepare the coding task and verification candidate. |
| Harness version, model metadata and login status | Check the selected tool without copying its credentials. |
| Saved runs and profiles | Recover work and reuse selected settings. |

## What Tokate writes

| Location | Data |
| --- | --- |
| Run directory | Checkout, metadata, private logs, patches and publication evidence. |
| Profile storage | Saved harness, model and effort settings. |
| Disposable copy under `/tmp` | Candidate files used by ordered owner checks. |
| User installation | Verified release binary and packaged guides. Uninstall keeps runs and credentials. |

Runs use `$XDG_STATE_HOME/tokate/runs` or `~/.local/state/tokate/runs`. An explicit `--runs` directory overrides this location.

Empty or relative state overrides use the fallback. Old runs and profiles remain in place, with no automatic migration.

## What Tokate sends to GitHub

| Data | Destination |
| --- | --- |
| Issue requests and coordination state | Issues and comments. |
| Donor and tool declarations | Public contribution records. |
| Commits and draft pull requests | Approved repository contribution. |
| Validated public summaries and receipts | Pull request descriptions and coordination records. |

Public summaries use a separate validated artifact. Tokate does not copy private reports, prompts or raw logs into them.

## What Tokate keeps private

| Data | Boundary |
| --- | --- |
| Credentials | `gh`, Codex, Claude, Pi and OMP own their authentication. Credentials are not transferred to owners. |
| Logs and raw reports | Stay in local run storage. They can contain sensitive tool output. |
| Prompts and patches | Stay local until selected content is used by a harness or published as a contribution. |
| Subscription quotas | Stay with the donor account. Tool and usage declarations are not remote attestations. |

Logs are bounded and can be truncated. There is no automatic expiry, general redaction or blanket `.env` exclusion inside a checkout.

## Other data destinations

| Recipient | Data |
| --- | --- |
| Selected harness and model service | Approved task, owner instructions and repository context. |
| Selected Pi endpoint | Inference requests. A local endpoint can contact other services. |
| Selected OMP provider | Requests through the account or local runtime configured in OMP. |
| Repository commands and verification tools | Data sent by those commands. Network access is enabled. |

Tokate adds no separate telemetry upload in these paths. GitHub, harnesses and model services set their own data policies.

## Execution boundaries

| Process | Boundary |
| --- | --- |
| Codex | Native permission profile restricts tool access to files. |
| Claude | Native file restrictions and Bash sandbox settings. |
| Pi and OMP | No additional Tokate sandbox. OMP tool calls are approved automatically. |
| Owner verification | Direct host execution in a disposable candidate copy with a narrow environment. |
| All command processes | `setpriv` and `unshare` support descendant cleanup on timeout or cancellation. |

Harnesses, configured extensions, installed tools and the kernel remain trusted. There are no CPU, RAM or disk quotas.

Tokate forwards specific authentication requirements, not arbitrary environment variables. Host tools can still read their own configuration and credentials.

See [Linux security](linux-security.md) for file access and diagnostic commands.

## Coordinator pin

The generated caller pins the shared workflow to a full commit SHA. It also fixes the release asset URL and SHA256 checksum.

The shared workflow checks the archive with `sha256sum -c -` before it extracts the binary. Changes in `obselate/tokate` do not reach your repository until you commit a new pin.

| Control | Effect |
| --- | --- |
| Caller `permissions: {}` | No default token permissions. |
| Caller job permissions | Cap access at `contents: write`, `issues: write` and `pull-requests: write`. |
| Coordinator and admission | Do not check out or execute donor code. |
| Ordinary fork CI | Keep it read-only and free of secrets. |
| Installer checksum and version checks | Detect corruption, not a compromised release account. |

Review staged files and public descriptions before publication. Passing checks do not replace review of correctness, scope or security.
