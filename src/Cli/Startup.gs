package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Linq
import System.Text.Json

internal class Startup {
    shared {
        private const AuthenticationTimeoutSeconds int32 = 10

        private const CannotExecuteExitCode int32 = 126

        private const CommandNotFoundExitCode int32 = 127

        internal func Gate(args Args, runtime JsonElement) Object {
            let model = args.Need("model")
            let effort = args.Need("effort")
            let path = args.Get(
                "policy",
                Path.Combine(args.Get("path", Directory.GetCurrentDirectory()), Policy.FilePath)
            )
            var text string
            var policy Policy

            try {
                text = File.ReadAllText(path)
            } catch (error Exception) when error is IOException || error is UnauthorizedAccessException {
                throw CliFailure(
                    "invalid_state",
                    "Cannot read the policy at " + path + ". Pass --policy FILE or run in a checkout."
                )
            }

            try {
                policy = Policy(text)
                policy.Validate("claude", "anthropic", model, effort, 1)
            } catch (error Exception) {
                throw CliFailure("verification_failed", error.Message)
            }

            let environment = List[string]()

            for entry in ClaudeCode.EnvironmentControls() {
                environment.Add(entry.Key + "=" + entry.Value)
            }

            let result = map[string, Object?]{
                "version": J.Text(runtime, "version"),
                "auth_status": J.Get(runtime, "auth_status"),
                "policy_hash": policy.Digest,
                "requested": map[string, Object?]{"model": model, "effort": effort},
                "invocation": ClaudeCode.Invocation(
                    model,
                    effort,
                    args.Need("claude-profile"),
                    policy.AllowedModels("claude", "anthropic", ClaudeCode.ModelPattern)
                ),
                "environment_controls": environment,
                "managed_execution_enabled": true,
                "limitations": []string{
                    "Local authentication schema and required interfaces checked; remote entitlement and model availability are not proven.",
                    "File restrictions and Bash sandboxing are Claude Code's own. Native reports are not remote identity attestations."
                }
            }

            if args.Get("path") != "" {
                result["configured_command"] = ClaudeCode.Command(
                    args.Need("harness-path"),
                    args.Need("claude-profile"),
                    args.Need("path")
                )
            }

            if args.Get("file") != "" {
                try {
                    result["native_reports"] = ClaudeCode.Reports(
                        ClaudeCode.Report(args.Need("file"), args.Need("claude-profile")),
                        model,
                        effort
                    )
                } catch (error Exception) {
                    throw CliFailure("verification_failed", error.Message)
                }
            }

            return result
        }

        internal func Scan(names[]string, harnessPath string = "") List[ToolCheck] {
            let tools = List[ToolCheck]()

            for name in names {
                let tool = ToolCheck{
                    Name: name,
                    Hint: Harness.Find(name)?.Hint ?? switch name {
                        case "git": "Install Git and add git to PATH."
                        case "gh": "Install GitHub CLI and add gh to PATH."
                        case "setsid": "Install util-linux and add setsid to PATH."
                        case "/usr/bin/setsid": "Install util-linux in a system path or Nix profile for catalog probes and independent verification."
                        case "/usr/bin/env": "Install coreutils in a system path or Nix profile for command cleanup and managed sandbox probes."
                        case "/usr/bin/unshare": "Install util-linux in a system path or Nix profile and enable user namespaces for command cleanup."
                        case "/usr/bin/setpriv": "Install util-linux in a system path or Nix profile for command cleanup."
                        case "curl": "Install curl and add curl to PATH."
                        case "tar": "Install tar and add tar to PATH."
                        case "/usr/bin/cp": "Install GNU coreutils in a system path or Nix profile for independent verification."
                        case "/usr/bin/find": "Install GNU findutils for independent verification."
                        case "/bin/bash": "Install Bash for Pi and Claude commands."
                        case "bwrap": "Install bubblewrap and add bwrap to PATH for the Claude Code sandbox."
                        case "socat": "Install socat and add socat to PATH for the Claude Code sandbox."
                        default: ""
                    }
                }

                tool.Path = Harness.Find(name) != nil ? LocalPaths.Harness(name, harnessPath): name.StartsWith("/") ?
                LocalPaths.SystemTool(Path.GetFileName(name)): LocalPaths.Find(name)

                if tool.Path != "" {
                    tool.Status = "found"
                    tool.Detail = name.StartsWith("/") ?
                    "Found through a system path or Nix profile; execution has not been checked.":
                    "Found on PATH; execution has not been checked."
                } else {
                    tool.Detail = tool.Hint
                }

                if tool.Path != "" && name.StartsWith("/") && !LocalPaths.Executable(tool.Path) {
                    tool.Status = "failed"
                    tool.Detail = "Required helper is not executable. " + tool.Hint
                } else if tool.Path != "" && LocalPaths.Musl() &&
                    (name == "setsid" || name.StartsWith("/usr/bin/")) &&
                    Path.GetFileName(LocalPaths.CanonicalPath(tool.Path)) == "busybox" {
                    tool.Status = "failed"
                    tool.Detail = "This operation requires the full tool, not its BusyBox applet. " + tool.Hint
                }

                tools.Add(tool)
            }

            return tools
        }

        internal func NeedsCatalog(command string, options Args?) bool -> (
            command == "defaults" && options?.Subject == "check"
        ) ||
            (command == "claim" && options?.Get("source") != "external") ||
            command == "work"

        private func DoctorScope(options Args) string -> options.Subject == "external" ||
            (
            options.Get("harness") != "" && Harness.DefaultProvider(options.Get("harness")) == "" &&
                (
                Harness.Find(options.Get("harness")) == nil ||
                    (options.Get("set-default") == "true" && options.Subject != "managed")
            )
        ) ? "external":
        options.Subject == "managed" || options.Get("harness") != "" || options.Get("harness-path") != "" ?
        "managed": "external"

        internal func Requirements(options Args)[]string {
            let command = options.Command

            if command == "doctor" && options.Subject != "repo" {
                let doctorScope = DoctorScope(options)
                let selected = Args([]string{doctorScope == "external" ? "external": "work"})

                for key in[]string{"harness", "harness-path", "pi-root", "node", "claude-profile"} {
                    if options.Get(key) != "" {
                        selected.Values["--" + key] = options.Get(key)
                    }
                }

                let names = List[string](Requirements(selected))
                names.AddRange(doctorScope == "external" ? []string{"curl", "tar"}: []string{})
                return names.ToArray()
            }

            if (command == "status" && options.Get("run") != "") ||
                (command == "defaults" && options.Subject != "check") {
                return []string{}
            }

            let names = List[string]{"setsid", "/usr/bin/env", "/usr/bin/setpriv", "/usr/bin/unshare", "gh"}
            var catalog = NeedsCatalog(command, options)
            var harness = options.Get("harness")
            if options.Get("run") != "" {
                let run = Data.Load(Path.GetFullPath(options.Need("run")))

                if command == "work" || command == "claim" {
                    catalog = run.Source != "external"
                    harness = options.Get("feedback") == "true" ? options.Get("harness"): run.Harness
                }
            }

            let adapter = Harness.Find(harness)

            if catalog && adapter?.Doctor == nil && harness != "command" {
                names.Add("codex")
            }

            if command == "work" ||
                command == "claim" ||
                command == "external" ||
                command == "submit" ||
                command == "amend" ||
                command == "checks" ||
                command == "overlaps" ||
                command == "coordinate" {
                names.Add("git")
            }

            let independent = command == "work" ||
                command == "claim" ||
                command == "external" ||
                (command == "amend" && (options.Get("commit") != "" || options.Get("seconds") != ""))
            if catalog || independent {
                names.Add("/usr/bin/setsid")
                names.AddRange(adapter?.Tools ?? []string{})
            }

            if independent {
                names.Add("/usr/bin/cp")

                if LocalPaths.Musl() {
                    names.Add("/usr/bin/find")
                }
            }

            if command == "init" && options.Get("pin") == "true" {
                names.Add("curl")
                names.Add("tar")
            }

            return names.ToArray()
        }

        internal func ExecuteChecks(tools List[ToolCheck]) {
            var runner bool
            var cleanup = true

            for tool in tools {
                runner = runner || (tool.Name == "setsid" && tool.Path != "")

                if tool.Name == "/usr/bin/env" || tool.Name == "/usr/bin/setpriv" || tool.Name == "/usr/bin/unshare" {
                    cleanup = cleanup && tool.Path != "" && tool.Status != "failed"
                }
            }

            runner = runner && cleanup

            for tool in tools {
                if tool.Path == "" || tool.Status == "failed" {
                    continue
                }

                if !runner {
                    tool.Status = "skipped"
                    tool.Detail = "Execution requires working command cleanup helpers. " + tool.Hint
                    continue
                }

                try {
                    let executable = Harness.Find(tool.Name) != nil && Path.GetFileName(
                        LocalPaths.CanonicalPath(tool.Path)
                    ) == "codex.js" ?
                    CodexRuntime.Resolve(tool.Path): tool.Path
                    tool.Path = executable

                    let result = Commands.Run(
                        executable,
                        []string{tool.Name == "socat" ? "-V": "--version"},
                        seconds: Commands.VersionTimeoutSeconds,
                        harness: Harness.Find(tool.Name) != nil
                    )

                    if result.Code != 0 || result.Truncated || result.ReadFailed {
                        tool.Status = "failed"
                        tool.Detail = (
                            result.Code == CannotExecuteExitCode ||
                                result.Code == CommandNotFoundExitCode ? "Tool could not start.": "Tool did not complete its version check successfully."
                        ) +
                            " Repair or reinstall it. " +
                            tool.Hint
                    } else {
                        tool.Status = "ready"
                        tool.Detail = "Successfully executed its version check."
                    }
                } catch (error CliFailure) {
                    tool.Status = "failed"
                    tool.Detail = error.Summary
                    tool.Code = error.Code

                    if error.Code.StartsWith("namespace_", StringComparison.Ordinal) {
                        tool.Hint = "Ask an administrator to review the host or container namespace policy."
                    }
                } catch (error Exception) {
                    tool.Status = "failed"
                    tool.Detail = "Tool could not start or complete --version. Repair or reinstall it. " + tool.Hint
                }

                if tool.Name == "setsid" && tool.Status != "ready" {
                    runner = false
                }
            }
        }

        private func Ready(tools List[ToolCheck], name string) bool {
            for tool in tools {
                if tool.Name == name {
                    return tool.Status == "ready"
                }
            }

            return false
        }

        private func Listed(tools List[ToolCheck]) List[ToolCheck] {
            let runner = tools.Find(tool -> tool.Name == "setsid" && tool.Path != "")
            return tools.FindAll(
                tool -> tool.Name != "/usr/bin/setsid" || tool.Path == "" || runner == nil || LocalPaths.CanonicalPath(
                    tool.Path
                ) != LocalPaths.CanonicalPath(runner.Path)
            )
        }

        internal func Show(tools List[ToolCheck], error bool = false) {
            for tool in tools {
                let style = tool.Status == "ready" ||
                    tool.Status == "found" ? "green": (tool.Status == "failed" ? "red": "yellow")
                Terminal.Row(tool.Name, tool.Status + " - " + tool.Detail, style, error)
            }
        }

        internal func Inspect(options Args) List[ToolCheck] {
            let harnessPath = options.Get("run") != "" && options.Command == "work" && options.Get(
                "feedback"
            ) != "true" ?
            Data.Load(Path.GetFullPath(options.Need("run"))).HarnessPath: options.Get("harness-path")
            let tools = Scan(Requirements(options), harnessPath)
            ExecuteChecks(tools)
            return tools
        }

        internal func Check(options Args) {
            let tools = Inspect(options)
            let blockers = List[ToolCheck]()

            for tool in tools {
                if tool.Status != "ready" {
                    blockers.Add(tool)
                }
            }

            if blockers.Count > 0 {
                if MachineSetup.TryFix(options, blockers) {
                    Check(options)

                    return
                }

                let listed = Listed(blockers)
                PublicOutput.Tools(listed)
                Show(listed, true)

                for tool in blockers {
                    if tool.Code.StartsWith("namespace_", StringComparison.Ordinal) {
                        throw CliFailure(tool.Code, tool.Detail)
                    }
                }

                throw CliFailure(
                    "missing_tools",
                    "Install or repair the tools needed for this command, then run the relevant tokate doctor scope."
                )
            }
        }

        private func Authentication(tools List[ToolCheck], name string) {
            let codex = Harness.Find(name) != nil
            let check = ToolCheck{
                Name: name + "-auth",
                Status: "skipped",
                Hint: codex ? "Run codex login with your ChatGPT subscription.": "Run gh auth login --hostname github.com with the account for this role.",
                Detail: "Authentication status requires a working " + name + " and setsid."
            }

            if Ready(tools, name) && Ready(tools, "setsid") {
                try {
                    var executable = name

                    for tool in tools {
                        if tool.Name == name {
                            executable = tool.Path
                        }
                    }

                    let result = Commands.Run(
                        executable,
                        codex ? []string{"login", "status"}: []string{
                            "api",
                            "user",
                            "--jq",
                            ".id",
                            "--hostname",
                            GitHub.Hostname
                        },
                        seconds: AuthenticationTimeoutSeconds,
                        harness: codex,
                        github: !codex
                    )

                    var actor int64

                    if result.Truncated || result.ReadFailed {
                        check.Status = "failed"
                        check.Detail = "Authentication status did not complete reliably. " + check.Hint
                    } else if result.Code == CannotExecuteExitCode || result.Code == CommandNotFoundExitCode {
                        check.Status = "failed"
                        check.Detail = "Authentication status tool could not start. Repair or reinstall " + name + "."
                    } else if result.Code != 0 ||
                        (
                        codex ? !(result.Output + result.Error).Contains("Logged in using ChatGPT"):
                        !Int64.TryParse(result.Output.Trim(), out actor) || actor < 1
                    ) {
                        check.Status = "authentication_required"
                        check.Detail = check.Hint
                        PublicOutput.Actions.Add(
                            codex ? []string{"codex", "login"}: []string{
                                "gh",
                                "auth",
                                "login",
                                "--hostname",
                                GitHub.Hostname
                            }
                        )
                    } else {
                        check.Status = "ready"
                        check.Detail = codex ? "ChatGPT login reported by codex login status.": "GitHub identity verified by gh api user."
                    }
                } catch (error Exception) {
                    check.Status = "failed"
                    check.Detail = "Authentication status could not start or complete. " + check.Hint
                }
            }

            tools.Add(check)
        }

        private func DoctorHarnesses(options Args) {
            let installed = List[ToolCheck]()

            for name in Harness.Table.Keys {
                let path = LocalPaths.Harness(name, options.Get("harness") == name ? options.Get("harness-path"): "")

                if path != "" && LocalPaths.Executable(path) {
                    installed.Add(ToolCheck{Name: name, Path: path})
                    Terminal.Row(name, "Detected at " + path)
                }
            }

            var saved JsonElement

            try {
                saved = DonorDefaults.Read()
            } catch (error Exception) {
                Terminal.Message(error.Message, error: true)
            }

            let selected = options.Get("set-default") == "true" ? options.Get("harness"): ""
            if selected != "" {
                var choice ToolCheck? = nil

                for tool in installed {
                    if tool.Name == selected {
                        choice = tool
                    }
                }

                if choice == nil {
                    throw CliFailure(
                        "missing_tools",
                        "The selected default harness was not found. Install it first, or supply --harness-path."
                    )
                }

                DonorDefaults.Run(
                    Args([]string{"defaults", "set", "--harness", selected, "--harness-path", choice.Path})
                )
                saved = DonorDefaults.Read()
                Terminal.Row("Default harness", selected)
            }

            if PublicOutput.ResultData is Dictionary[string, Object?]fields {
                let rows = List[Object]()

                for tool in installed {
                    rows.Add(map[string, Object?]{"name": tool.Name, "path": tool.Path})
                }

                fields["harnesses"] = rows.ToArray()
                fields["default_harness"] = J.Text(saved, "harness")
            }
        }

        internal func Doctor(options Args) int32 {
            if options.Subject == "repo" {
                return OwnerHealth.Run(options)
            }

            if options.Subject == "managed" && options.Get("harness") == "" {
                let saved = DonorDefaults.Read()

                if J.Text(saved, "harness") != "" {
                    if !DonorSelection.Managed(saved) {
                        throw Exception(
                            "The default harness uses external work. Use doctor codex, doctor claude, doctor pi or doctor omp for managed diagnostics."
                        )
                    }

                    for key in[]string{"harness", "harness-path", "pi-root", "node", "claude-profile"} {
                        if options.Get(key) == "" && J.Text(saved, key) != "" {
                            options.Values["--" + key] = J.Text(saved, key)
                        }
                    }

                    DonorDefaults.CheckPaths(options, saved)
                    options.HarnessFromDefault = true
                }
            }

            let doctorScope = DoctorScope(options)
            let adapter = doctorScope == "managed" ? Harness.Find(options.Get("harness")): nil
            let tools = Inspect(options)

            if options.Get("fix") == "true" && MachineSetup.TryFix(options, tools) {
                return Doctor(options)
            }

            var probe = Ready(tools, "setsid") && Ready(tools, "/usr/bin/setsid")

            if probe && adapter is Harness selected && selected.Doctor is Action[Args, ToolCheck]check {
                let runtime = ToolCheck{Name: options.Get("harness"), Hint: selected.Hint}
                let installable = selected.Nix != ""
                let missing = installable && options.Get("pi-root") == "" && options.Get("harness-path") == "" &&
                    LocalPaths.Harness(options.Get("harness")) == ""
                try {
                    check(options, runtime)
                    runtime.Status = "ready"
                } catch (error Exception) {
                    runtime.Status = "failed"
                    if error is CliFailure failure {
                        runtime.Code = failure.Code
                    }

                    runtime.Detail = error.Message
                    if installable && SetupUserId() == 0 {
                        runtime.Detail += ". If running as root, retry as a regular user."
                    }
                    if installable && options.Get("fix") == "true" {
                        Terminal.Message(error.Message, "yellow", true)
                    }

                    if options.Get("fix") == "true" && missing && MachineSetup.Harness(options) {
                        return Doctor(options)
                    }

                    probe = false
                }

                tools.Add(runtime)
            }

            if doctorScope == "managed" && adapter?.Doctor == nil {
                ProbeSandbox(options, tools, probe)
            }

            if options.Get("auth") == "true" {
                Authentication(tools, "gh")

                if doctorScope == "managed" && adapter?.Doctor == nil {
                    Authentication(tools, "codex")
                }
            }

            return ReportDoctor(options, tools, doctorScope)
        }

        private func ReportDoctor(options Args, tools List[ToolCheck], doctorScope string) int32 {
            let listed = Listed(tools)
            PublicOutput.Tools(listed)

            if PublicOutput.ResultData is Dictionary[string, Object?]fields {
                fields["scope"] = doctorScope
                fields["authentication_requested"] = options.Get("auth") == "true" || options.Get("model") != ""
            }

            Terminal.Heading("Tokate " + doctorScope + " diagnostics")
            Show(listed)

            if tools.FirstOrDefault(tool -> tool.Report != nil)?.Report is JsonElement native {
                let report = Gate(options, native)

                if PublicOutput.ResultData is Dictionary[string, Object?]fields {
                    fields["claude"] = report
                }
            }

            if (doctorScope == "external" && options.Subject != "external") || options.Get("set-default") == "true" {
                DoctorHarnesses(options)
            }

            Terminal.Message(
                "Checked capabilities are listed above. No inference was run. PATH, startup, login and catalog data do not prove model availability or subscription allowance. Repository dependencies and builds were not checked.",
                "grey"
            )

            var code = ""
            for tool in tools {
                if tool.Status != "ready" {
                    let failure = tool.Code.StartsWith("namespace_", StringComparison.Ordinal) ? tool.Code:
                    tool.Status == "authentication_required" ? "authentication_required": (
                        tool.Name == "sandbox" ? "verification_failed": "missing_tools"
                    )

                    if code == "" || failure.StartsWith("namespace_", StringComparison.Ordinal) ||
                        (failure == "missing_tools" && !code.StartsWith("namespace_", StringComparison.Ordinal)) {
                        code = failure
                    }
                }
            }

            if code != "" {
                if code == "missing_tools" && options.Get("fix") != "true" {
                    let word = options.Get("harness") == "" ? doctorScope: options.Get("harness")
                    PublicOutput.Actions.Add([]string{"tokate", "doctor", word, "--fix"})
                }

                throw CliFailure(
                    code,
                    code == "verification_failed" ? "Required sandbox diagnostics failed. Follow the sandbox repair instructions above.": CliFailure.Message(
                        code
                    )
                )
            }

            return 0
        }

        private func ProbeSandbox(options Args, tools List[ToolCheck], probe bool) {
            let sandbox = ToolCheck{
                Name: "sandbox",
                Status: "skipped",
                Hint: "Ensure native Codex sandbox support and permission profiles. Tokate does not change security settings.",
                Detail: "Requires working setsid, /usr/bin/setsid, /usr/bin/env and codex."
            }

            if probe && Ready(tools, "codex") && Ready(tools, "/usr/bin/env") {
                try {
                    let pinned = Worker.Doctor(options.Get("harness-path"))

                    sandbox.Status = "ready"
                    sandbox.Detail = "Checkout and private /tmp writable. Control files and Git metadata unreadable."
                    if pinned {
                        sandbox.Detail += " Repository global.json SDK/MSBuild starts inside the sandbox."
                    }
                } catch (error CliFailure) {
                    if error.Code == "missing_tools" {
                        sandbox.Status = "ready"
                        sandbox.Detail = "Sandbox isolation probe passed; pinned toolchain probe failed."
                        tools.Add(
                            ToolCheck{Name: "toolchain", Status: "failed", Hint: error.Summary, Detail: error.Summary}
                        )
                    } else {
                        sandbox.Status = "failed"
                        sandbox.Detail = error.Summary
                        sandbox.Code = error.Code
                    }
                } catch (error Exception) {
                    sandbox.Status = "failed"
                    sandbox.Detail = "Sandbox probe could not complete. " +
                        sandbox.Hint +
                        " Ensure temporary storage is writable and repository global.json is a regular file, not a symbolic link."
                }
            }

            tools.Add(sandbox)
        }
    }
}
