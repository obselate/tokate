# Native Claude checks

These checks exercise native Claude controls with local synthetic responses. They use no external inference.

## Run the checks

1. Build Tokate with the [development guide](development.md).

2. Download the official native Claude executable.

   ```sh
   python3 scripts/claude-download.py --output /tmp/claude
   ```

3. Run the proof.

   ```sh
   python3 scripts/claude-proof.py --claude /tmp/claude
   ```

4. Read the diagnostic gate requirements.

   ```sh
   tokate help claude-capabilities
   ```

## Evidence

| Check | Evidence |
| --- | --- |
| Download | Official latest channel, manifest size, SHA256 and native Linux x64 artifact. |
| Login | Existing default login reuse and native Pro and Max authentication schemas. Authentication stays in Claude. |
| Prerequisites | Python 3, Linux bubblewrap at `/usr/bin/bwrap`, a built Tokate binary and a Claude model with an effort in `.github/tokate.json`. |
| Tools | Native file and Bash controls, plus configured MCP tools. |
| Model and effort | Exact requests checked by the synthetic service. Reports omit effort. |
| Lifecycle | Cancellation, timeout and child cleanup. |
| Isolation | Linux bubblewrap blocks external service access. |
| Stored login data | Tokate retains bounded native login metadata, not credentials. |
| Not established | Real subscription use, remote model identity, model availability or arbitrary containment attacks. |

Configuration follows [Claude's CLI](https://code.claude.com/docs/en/cli-reference) and [sandbox controls](https://code.claude.com/docs/en/sandboxing).

## If something fails

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `Linux bubblewrap is required; no fallback` | `tokate doctor claude --json` |
| `Official native artifact checksum or size mismatch` | `python3 scripts/claude-download.py --output /tmp/claude` |
| `Native proof requires an explicit Claude model/effort in the repository policy` | `${EDITOR:-vi} .github/tokate.json` |
| `Native Claude proof failed; do not publish managed support` | `tokate doctor claude --json` |
