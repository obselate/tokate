package Tokate

import Microsoft.Win32.SafeHandles
import System
import System.Collections.Generic
import System.IO
import System.Runtime.InteropServices
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

internal class ClaudeCode {
    shared {
        private func Profile(path string) string {
            let profile = LocalPaths.RuntimePath(path)
            let canonical = LocalPaths.CanonicalPath(profile)

            if canonical == "/" || canonical == Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) {
                throw ExecutionFailure.Create(
                    "invalid_state",
                    "Select a Claude configuration directory, not the entire home or filesystem"
                )
            }

            return profile
        }

        private func DefaultProfile() string -> Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".claude"
        )

        private let RequiredFlags[]string = []string{
            "--permission-mode",
            "--permission-prompts",
            "--settings",
            "--model",
            "--effort",
            "--output-format",
            "--verbose",
            "--print"
        }

        private func BypassPolicy() {
            let files = List[string]{"/etc/claude-code/managed-settings.json"}

            if Directory.Exists("/etc/claude-code/managed-settings.d") {
                files.AddRange(Directory.GetFiles("/etc/claude-code/managed-settings.d", "*.json"))
            }

            for file in files {
                if !File.Exists(file) {
                    continue
                }

                let settings = J.Parse(File.ReadAllText(file))
                if J.Text(J.Get(settings, "permissions"), "disableBypassPermissionsMode") == "disable" {
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "Claude managed settings disable bypassPermissions mode, which unattended Tokate runs require. No inference started."
                    )
                }
            }
        }

        internal func Authentication(value JsonElement) JsonElement {
            if J.Get(value, "loggedIn").ValueKind != JsonValueKind.True || J.Text(value, "authMethod") != "claude.ai" ||
                J.Text(value, "apiProvider") != "firstParty" ||
                (J.Text(value, "subscriptionType") != "pro" && J.Text(value, "subscriptionType") != "max") {
                throw ExecutionFailure.Create(
                    "authentication_required",
                    "Claude requires loggedIn true, claude.ai, firstParty and personal pro or max status. No inference started."
                )
            }

            return J.Parse(J.Write(J.Select(value, "loggedIn,authMethod,apiProvider,subscriptionType")))
        }

        internal func EnvironmentControls() Dictionary[string, string] -> map[string, string]{
            "DISABLE_AUTOUPDATER": "1",
            "CLAUDE_CODE_DISABLE_TERMINAL_TITLE": "1",
            "CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK": "1",
            "CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK": "1",
            "CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK": "1",
            "CLAUDE_CODE_MAX_RETRIES": "0",
            "CLAUDE_CODE_NONSTREAMING_TIMEOUT_RETRIES": "0"
        }

        internal let ModelPattern string = "^claude-(?:(?:opus|sonnet|haiku)-5-5|fable-5(?:-1)?|opus-5|sonnet-5|opus-4-[678]|sonnet-4-6)(?:-[0-9]{8})?$"

        internal func Settings(profile string, models List[string]?) JsonElement {
            let settings = map[string, Object?]{
                "switchModelsOnFlag": false,
                "fallbackModel": []string{},
                "modelOverrides": map[string, Object?]{},
                "permissions": map[string, Object?]{"blockReadsOutsideWorkingDirectories": true},
                "sandbox": map[string, Object?]{
                    "enabled": true,
                    "failIfUnavailable": true,
                    "allowUnsandboxedCommands": false,
                    "autoAllowBashIfSandboxed": false,
                    "excludedCommands": []string{},
                    "filesystem": map[string, Object?]{"denyRead": []string{profile}, "denyWrite": []string{profile}},
                    "network": map[string, Object?]{
                        "allowedDomains": []string{"*"},
                        "strictAllowlist": true,
                        "allowLocalBinding": true,
                        "allowAllUnixSockets": false
                    }
                }
            }

            if let allowed = models {
                settings["availableModels"] = allowed
            }

            return J.Parse(J.Write(settings))
        }

        internal func Invocation(model string, effort string, profile string, models List[string]?)[]string -> []string{
            "--permission-mode",
            "bypassPermissions",
            "--permission-prompts",
            "none",
            "--settings",
            Settings(profile, models).GetRawText(),
            "--model",
            model,
            "--effort",
            effort,
            "--output-format",
            "stream-json",
            "--verbose",
            "--print"
        }

        internal func Command(binary string, profile string, checkout string)[]string {
            let repository = LocalPaths.DirectoryPath(checkout)

            for path in[]string{binary, profile} {
                let canonical = LocalPaths.CanonicalPath(path)
                if LocalPaths.Within(canonical, repository) || LocalPaths.Within(repository, canonical) {
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "Claude runtime and profile must be outside the selected checkout."
                    )
                }
            }

            let command = Variables(profile)
            command.Add(binary)

            return command.ToArray()
        }

        private func Variables(profile string) List[string] {
            let values = List[string]()

            for entry in EnvironmentControls() {
                values.Add(entry.Key + "=" + entry.Value)
            }

            if profile != "" && profile != DefaultProfile() {
                values.Add("CLAUDE_CONFIG_DIR=" + profile)
            }

            return values
        }

        private func Native(binary string, profile string, args[]string, budget RuntimeBudget) CommandResult {
            let command = Variables(profile)
            command.Add(binary)
            command.AddRange(args)

            return Commands.Run(
                LocalPaths.NeedSystemTool("env"),
                command.ToArray(),
                "/",
                seconds: 30,
                strictOutput: true,
                budget: budget,
                cancellation: Gsharp.Concurrency.Chan[bool](1)
            )
        }

        internal func Reports(text string, model string, effort string, evidence Evidence? = nil) JsonElement {
            try {
                var started int32
                var completed int32
                var report = ""
                var stop = ""
                let reports = map[string, Object?]{}

                for line in text.Split('\n') {
                    if String.IsNullOrWhiteSpace(line) {
                        continue
                    }

                    let value = RequestData.Parse(line, 1024 * 1024)
                    if J.Get(value, "parent_tool_use_id").ValueKind == JsonValueKind.String {
                        continue
                    }

                    let type = J.Text(value, "type")

                    if evidence != nil &&
                        completed != 0 &&
                        (
                        type == "assistant" ||
                            type == "result" ||
                            (type == "system" && J.Text(value, "subtype") == "init")
                    ) {
                        throw ExecutionFailure.Create("inference_failed", "Claude emitted events after completion")
                    }

                    if type == "system" && J.Text(value, "subtype") == "init" {
                        started++
                        ReportField(reports, value, "model", model)
                        ReportField(reports, value, "effort", effort)
                        ReportField(reports, value, "effortLevel", effort)
                    }

                    if type == "assistant" {
                        ReportField(reports, J.Get(value, "message"), "model", model)
                        stop = J.Text(J.Get(value, "message"), "stop_reason")
                    }

                    if type == "result" {
                        completed++
                        if evidence != nil &&
                            (
                            started != 1 || completed != 1 || J.Text(value, "subtype") != "success" || J.Get(
                                value,
                                "is_error"
                            )
                                .ValueKind != JsonValueKind.False ||
                                (stop != "" && stop != "end_turn" && stop != "stop_sequence")
                        ) {
                            throw ExecutionFailure.Create(
                                "inference_failed",
                                "Claude reported a failed or incomplete response; no retry or fallback"
                            )
                        }

                        report = J.Text(value, "result")
                        ReportField(reports, value, "model", model)
                        ReportField(reports, value, "effort", effort)
                        ReportField(reports, value, "effortLevel", effort)

                        let usage = J.Get(value, "usage")
                        if usage.ValueKind == JsonValueKind.Object {
                            reports["usage"] = NumericUsage(usage)
                        }

                        let models = J.Get(value, "modelUsage")
                        if models.ValueKind == JsonValueKind.Object {
                            let usageByModel = map[string, Object?]{}

                            for usageModel in models.EnumerateObject() {
                                usageByModel[usageModel.Name] = NumericUsage(usageModel.Value)
                            }

                            reports["model_usage"] = usageByModel
                        }
                    }
                }

                if let target = evidence {
                    if started != 1 || completed != 1 || String.IsNullOrWhiteSpace(report) {
                        throw ExecutionFailure.Create(
                            "inference_failed",
                            "Claude did not return exactly one completed turn and report"
                        )
                    }

                    target.Report = report
                }

                return J.Parse(J.Write(reports))
            } catch (error JsonException) {
                throw ExecutionFailure.From(error, "inference_failed")
            }
        }

        private func ReportField(reports Dictionary[string, Object?], value JsonElement, key string, expected string) {
            let field = J.Get(value, key)
            if field.ValueKind != JsonValueKind.Undefined {
                if field.ValueKind != JsonValueKind.String || field.GetString() != expected {
                    throw ExecutionFailure.Create(
                        "inference_failed",
                        "Claude reported conflicting " + key + "; no retry or fallback is allowed."
                    )
                }

                reports[key] = field
            }
        }

        private func NumericUsage(value JsonElement) JsonElement {
            let result = map[string, Object?]{}

            for key in[]string{
                "input_tokens",
                "output_tokens",
                "cache_creation_input_tokens",
                "cache_read_input_tokens",
                "inputTokens",
                "outputTokens",
                "cacheReadInputTokens",
                "cacheCreationInputTokens",
                "costUSD"
            } {
                let field = J.Get(value, key)
                if field.ValueKind == JsonValueKind.Number && field.GetDouble() >= 0 {
                    result[key] = field
                }
            }

            return J.Parse(J.Write(result))
        }

        private func Report(path string, profile string) string {
            let full = Path.GetFullPath(path)

            LocalPaths.DirectoryPath(Path.GetDirectoryName(full) ?? "/")

            let metadata = [256]byte

            if full == profile || full.StartsWith(profile + "/") ||
                RuntimeMetadataStat(-100, full, 256, 1, metadata) != 0 ||
                (BitConverter.ToUInt16(metadata, 28) & 61440) != 32768 {
                throw ExecutionFailure.Create(
                    "invalid_state",
                    "Claude native report must be a regular unlinked file outside the native-login profile."
                )
            }

            let descriptor = RuntimeMetadataOpen(full, 131072 | 2048 | 524288)
            if descriptor < 0 {
                throw ExecutionFailure.Create("invalid_state", "Cannot safely open Claude native report.")
            }

            using let handle = SafeFileHandle(IntPtr(descriptor), true)
            using let file = FileStream(handle, FileAccess.Read)
            if !file.CanSeek {
                throw ExecutionFailure.Create("invalid_state", "Claude native report must be a regular file.")
            }

            using let reader = BinaryReader(file)
            let bytes = reader.ReadBytes(1024 * 1024 + 1)
            if bytes.Length > 1024 * 1024 {
                throw ExecutionFailure.Create("invalid_state", "Claude native report exceeds 1 MiB.")
            }

            return UTF8Encoding(false, true).GetString(bytes)
        }

        internal func Runtime(args Args, budget RuntimeBudget? = nil, authenticate bool = true) JsonElement {
            try {
                if !OperatingSystem.IsLinux() ||
                    System
                    .Runtime
                    .InteropServices
                    .RuntimeInformation
                    .ProcessArchitecture != Architecture
                    .X64 {
                    throw ExecutionFailure.Create(
                        "missing_tools",
                        "Claude capability checks require Linux x64; no host fallback or installation."
                    )
                }

                let found = LocalPaths.Harness("claude", args.Get("harness-path"))
                if found == "" {
                    throw ExecutionFailure.Create(
                        "missing_tools",
                        "Claude Code was not found. Install it with its native installer and sign in, or select --harness-path FILE. No inference started."
                    )
                }

                let binary = LocalPaths.CanonicalPath(found)
                if !CodexRuntime.Native(binary) {
                    throw ExecutionFailure.Create(
                        "missing_tools",
                        "Claude requires an installed unmodified native Linux x64 executable; launchers are unsupported."
                    )
                }

                args.Values["--harness-path"] = binary

                let limit = budget ?? RuntimeBudget(System.Diagnostics.Stopwatch.StartNew(), 90)
                let version = Native(binary, "", []string{"--version"}, limit)
                if version.Code != 0 || version.Truncated || version.ReadFailed || !Regex.IsMatch(
                    version.Output.Trim(),
                    "^[0-9]+\\.[0-9]+\\.[0-9]+ \\(Claude Code\\)\\z"
                ) {
                    throw ExecutionFailure.Create(
                        "missing_tools",
                        "Claude native version interface failed; no inference started."
                    )
                }

                let help = Native(binary, "", []string{"--help"}, limit)
                if help.Code != 0 || help.Truncated || help.ReadFailed {
                    throw ExecutionFailure.Create(
                        "missing_tools",
                        "Claude native help interface failed; no inference started."
                    )
                }

                for flag in RequiredFlags {
                    if !Regex.IsMatch(
                        help.Output,
                        "(?m)^ {0,4}(?:-[A-Za-z], *)?" + Regex.Escape(flag) + "(?:[ ,<]|$)"
                    ) {
                        throw ExecutionFailure.Create(
                            "missing_tools",
                            "Selected " + version.Output.Trim() +
                                " at " +
                                binary +
                                " is missing " +
                                flag +
                                ". Update Claude Code through its installation method or select --harness-path FILE. No inference started."
                        )
                    }
                }

                BypassPolicy()

                let requestedProfile = LocalPaths.RuntimePath(
                    args.Get(
                        "claude-profile",
                        Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR") ?? DefaultProfile()
                    )
                )
                if !Directory.Exists(requestedProfile) {
                    throw CliFailure(
                        "authentication_required",
                        "Sign in with Claude Code, then retry. Tokate uses your existing Claude profile."
                    )
                }

                let profile = Profile(requestedProfile)
                args.Values["--claude-profile"] = profile

                var authentication = JsonElement{}
                if authenticate {
                    let status = Native(binary, profile, []string{"auth", "status"}, limit)
                    if status.Code != 0 || status.Truncated || status.ReadFailed {
                        throw CliFailure(
                            "authentication_required",
                            "Claude auth status did not confirm a login. Sign in with Claude Code, then retry."
                        )
                    }

                    authentication = Authentication(RequestData.Parse(status.Output, 16384))
                }

                return J.Parse(
                    J.Write(
                        map[string, Object?]{
                            "version": version.Output.Trim(),
                            "auth_status": authenticate ? authentication: J.Parse("null")
                        }
                    )
                )
            } catch (error Exception) when error is IOException ||
                error is UnauthorizedAccessException ||
                error is JsonException {
                throw ExecutionFailure.From(error, "missing_tools")
            }
        }

        internal func Pair(model string, effort string) bool ->
        Regex.IsMatch(model, ModelPattern) &&
            (
            effort == "low" ||
                effort == "medium" ||
                effort == "high" ||
                effort == "max" ||
                (effort == "xhigh" && !Regex.IsMatch(model, "^claude-(?:opus|sonnet)-4-6(?:-|$)"))
        )

        internal func Gate(args Args, runtime JsonElement) Object {
            let model = args.Need("model")
            let effort = args.Need("effort")
            let policy = Policy(
                File.ReadAllText(
                    args.Get(
                        "policy",
                        Path.Combine(args.Get("path", Directory.GetCurrentDirectory()), ".github/tokate.json")
                    )
                )
            )

            policy.Validate("claude", "anthropic", model, effort, 1)

            let environment = List[string]()

            for entry in EnvironmentControls() {
                environment.Add(entry.Key + "=" + entry.Value)
            }

            let result = map[string, Object?]{
                "version": J.Text(runtime, "version"),
                "auth_status": J.Get(runtime, "auth_status"),
                "policy_hash": policy.Digest,
                "requested": map[string, Object?]{"model": model, "effort": effort},
                "invocation": Invocation(
                    model,
                    effort,
                    args.Need("claude-profile"),
                    policy.AllowedModels("claude", "anthropic", ModelPattern)
                ),
                "environment_controls": environment,
                "managed_execution_enabled": true,
                "limitations": []string{
                    "Local authentication schema and required interfaces checked; remote entitlement and model availability are not proven.",
                    "File restrictions and Bash sandboxing are Claude Code's own. Native reports are not remote identity attestations."
                }
            }

            if args.Get("path") != "" {
                result["configured_command"] = Command(
                    args.Need("harness-path"),
                    args.Need("claude-profile"),
                    args.Need("path")
                )
            }

            if args.Get("file") != "" {
                result["native_reports"] = Reports(
                    Report(args.Need("file"), args.Need("claude-profile")),
                    model,
                    effort
                )
            }

            return result
        }
    }
}
