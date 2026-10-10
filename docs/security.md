# Data and isolation

Tokate coordinates public GitHub issues and PRs. Donors keep their own accounts
and tools. Credentials and subscription quotas are not transferred to owners.
Tokate adds no separate telemetry upload in these paths. GitHub, harnesses and
model services have their own data policies.

## What leaves your machine

| Recipient | Data |
| --- | --- |
| GitHub | Issue requests, coordination state, donor/tool declarations, commits, draft PRs, public summaries and receipts. |
| Selected harness and model service | Approved task, owner instructions and repository context used during coding. |
| Selected Pi endpoint | Local-model inference requests. A loopback endpoint may itself contact other services. |
| Selected OMP provider | Inference requests through the provider account or local runtime configured in OMP. |
| Command destinations | Harness tools, repository commands and verification have network access. |

PR summaries come from a dedicated validated public artifact, not private reports,
prompts or raw logs. Tool identity, usage and local check declarations are not remote
attestations. Review staged files and public descriptions before publication.
A repository or tool can contain or print secrets. Tokate is not a general secret
scanner, and there is no blanket `.env` exclusion inside an approved checkout.

## Authentication and discovery

GitHub operations use `gh` and its credential helper. Codex and Claude Code own
their native logins.
Tokate forwards only specific authentication requirements to those host tools.
It does not read credential files, mixed configuration or whole environments to
infer model defaults. Pi supplies nonsecret model metadata through its SDK and
runs its normal CLI with the selected configuration. OMP lists its own models and
uses its stored login; Tokate forwards no API key variables to it.

Host tools are trusted programs with their own file access. Narrow child environments
are not whole-program isolation. Custom proxies, certificates and home-only build
caches may need system setup. Tokate does not expose arbitrary environment passthrough.

## Execution boundaries

Tokate does not sandbox harnesses or verification. Codex, Claude, Pi and OMP run as your
own processes with your configuration, home and `PATH`. Tokate passes a Codex
permission profile and Claude sandbox settings, and each harness enforces its own
native sandboxing. Pi and OMP have no extra isolation, and OMP tool calls are approved
automatically; run local models and harnesses in podman or similar if you want it. Tokate wraps commands in `setpriv` and `unshare` only to
collect descendants on timeout, cancellation or when Tokate itself is killed. Configured extensions can access the
selected profile, including its credentials. Only use configurations and extensions
you trust. Native project-trust settings still apply.
The harness and its tools always have network access. Remote services reached
through tools are outside the client sandbox.
Local interface checks and synthetic protocol tests do not attest remote model
identity, effective effort or subscription entitlement.

Owner verification runs directly in a disposable copy of the candidate under `/tmp`
with a minimal environment (`PATH`, `HOME`, `LANG`; no GitHub or OpenAI credentials).
Ordered checks share that copy. Verification has network access so dependency
installs work, and its commands are trusted host programs.

Tokate does not sandbox coding done through external tools. The kernel, installed
tools and selected runtimes remain trusted. There are no CPU, RAM or disk quotas.
Timeout and cancellation collect client descendants but do not prove server resource
or billing limits. Abrupt termination can leave incomplete evidence.

## Local state

Runs live under `$XDG_STATE_HOME/tokate/runs`, falling back to
`~/.local/state/tokate/runs`, or an explicit `--runs` directory. Empty or relative
state overrides use the fallback. Saved discovery still finds previous runs.
Profiles prefer the current state directory and read previous profiles when absent.
Nothing is migrated automatically. Explicit profile removal clears both locations.
They contain checkouts, metadata, private logs, patches and publication evidence.
Logs are bounded and can be truncated. They can contain sensitive tool output.
There is no automatic expiry or general redaction. Keep them private and preserve
them for recovery. Public status summaries omit raw logs.

The installer verifies archive checksums and binary versions before replacement.
This detects corruption, not a compromised release account. It manages the user
installation without sudo. Uninstall preserves runs and credentials.

The owner coordinator uses privileged GitHub operations without checking out or
executing donor code. Keep ordinary fork CI read-only and free of secrets. Passing
checks do not replace review of correctness, scope or security.
