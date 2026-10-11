# Native Claude checks

These checks exercise native controls without external inference. They do not
establish subscription availability or remote model identity.

```sh
python3 scripts/claude-download.py --output /tmp/claude
python3 scripts/claude-proof.py --claude /tmp/claude
```

The helper resolves the official latest channel and verifies manifest size and
SHA256. Ordinary synthetic fixtures cover existing login reuse, configured MCP
tools, exact model requests, cancellation and child cleanup without
external inference. Reports omit effort, which is checked only in the synthetic
request. Authentication stays in Claude; Tokate retains only bounded native
login metadata. Native file and Bash controls use Claude's own
sandbox settings. Real subscription use remains unverified.

Use `tokate help claude-capabilities` for the diagnostic gate. Configuration follows
[Claude's CLI](https://code.claude.com/docs/en/cli-reference) and
[sandboxing controls](https://code.claude.com/docs/en/sandboxing).
