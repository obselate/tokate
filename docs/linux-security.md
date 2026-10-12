# Linux namespace policy

Tokate uses Linux user and PID namespaces for descendant cleanup. File restrictions come from the selected harness, not from these namespaces.

## Check your host

1. Check owner tools.

   ```sh
   tokate doctor owner --json
   ```

2. Check the harness you use.

   ```sh
   tokate doctor codex --json
   tokate doctor claude --json
   tokate doctor pi --json
   tokate doctor omp --json
   ```

## File and network access

| Process | Writable | Unreadable | Network |
| --- | --- | --- | --- |
| Codex tools | Checkout except `.git`, plus `/tmp`. | `.git`, private run files and paths outside the native minimal filesystem and approved runtime paths. | Enabled during coding. Disabled during the isolation probe. |
| Claude tools | Working directory under native Claude controls. | Reads outside working directories are blocked. Bash sandbox denies reads and writes to the Claude profile. | All domains allowed. Local binding allowed. |
| Pi and OMP | Files allowed by the host user and tool configuration. | No additional Tokate file restriction. | Enabled. |
| Owner verification | Disposable candidate copy and other paths allowed by the host user. | No Tokate file sandbox. Credential environment variables are not forwarded. | Enabled for dependency installs. |

`tokate doctor managed --json` runs the Codex permission-profile probe for managed Codex. The probe checks checkout and `/tmp` writes, blocked private files and blocked `.git/config` reads.

## Ubuntu AppArmor

1. Ask an administrator to inspect AppArmor denials for `unshare` and bubblewrap.

2. Have the administrator save a profile for the denied executable in `/etc/apparmor.d/tokate-unshare`.

   ```text
   abi <abi/4.0>,
   profile unshare /usr/bin/unshare flags=(unconfined) {
     userns,
   }
   ```

3. Have the administrator load the reviewed profile.

   ```sh
   sudo apparmor_parser -r /etc/apparmor.d/tokate-unshare
   ```

4. Run doctor as your regular user.

   ```sh
   tokate doctor managed --json
   ```

| Host requirement | Purpose |
| --- | --- |
| `unshare`, `setpriv` and working user and PID namespaces | Collect command descendants. |
| Native Codex sandbox support | Enforce the Codex permission profile. |
| Administrator-approved security policy | Permit namespace startup. Tokate does not change AppArmor, SELinux, sysctls or container settings. |

See [Ubuntu's AppArmor guidance](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/) and [data boundaries](security.md).

## If something fails

Ask an administrator to repair the named host policy before you repeat the check.

| Symptom (exact message text) | Do (exact command) |
| --- | --- |
| `Required tools are missing or failed diagnostics. Run doctor.` | `tokate doctor managed --fix` |
| `User namespaces are disabled. Ask an administrator to review the host or container namespace policy.` | `tokate doctor managed --json` |
| `Namespace startup was denied while AppArmor namespace restrictions are enabled. Ask an administrator to review the relevant AppArmor denials.` | `tokate doctor managed --json` |
| `Namespace startup failed. Ask an administrator to review kernel support, namespace limits and host or container security policy.` | `tokate doctor managed --json` |
| `Managed sandbox isolation probe failed. Check native Codex sandbox support and permission profiles. Tokate does not change security settings.` | `tokate doctor codex --json` |
| `Pinned SDK/MSBuild startup failed. Install the global.json SDK in a standard system path; home-directory tools are unavailable.` | `tokate doctor codex --json` |
