# Linux namespace policy

Tokate requires working user and PID namespaces through `unshare`, plus `setpriv`, for descendant cleanup. This is not a sandbox. It does not change
AppArmor, SELinux, sysctls or container security settings.

`tokate doctor --managed --json` also runs the Codex permission-profile probe for managed Codex.

| Diagnostic | Action |
| --- | --- |
| `missing_tools` | Install or repair the named executable. |
| `namespace_disabled` | Ask the administrator to review disabled user namespaces. |
| `namespace_restricted` | Namespace startup failed with AppArmor restrictions enabled. Ask the administrator to inspect the corresponding AppArmor denial. |
| `namespace_unavailable` | Check kernel support, namespace limits and container security policy. |
| `verification_failed` | Inspect the diagnostic. |

## Ubuntu AppArmor

Stock Ubuntu 24.04 can deny the namespace operations used by Tokate. An
administrator can allow them for the installed Tokate executable while retaining
the global restriction. Replace the path below with its actual absolute path:

```text
abi <abi/4.0>,
profile tokate /absolute/path/to/tokate flags=(unconfined) {
  userns,
}
```

Save the profile as `/etc/apparmor.d/tokate`, load it with
`sudo apparmor_parser -r /etc/apparmor.d/tokate`, and rerun doctor as
the regular user. Review the profile again if the executable moves. This permits
namespace setup.

See [Ubuntu's AppArmor guidance](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/).
