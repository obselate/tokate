package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Runtime.InteropServices
import System.Text.Json
import System.Text.RegularExpressions

internal class OmpRuntime {
    shared {
        internal func Command(executable string) List[string] {
            let command = List[string]()
            for key in[]string{"PI_CONFIG_DIR", "PI_CODING_AGENT_DIR", "OMP_PROFILE", "PI_PROFILE"} {
                let value = Environment.GetEnvironmentVariable(key) ?? ""
                if value != "" {
                    command.Add(key + "=" + value)
                }
            }
            command.Add(executable)
            return command
        }

        private func Native(executable string, arguments[]string, seconds int32, budget RuntimeBudget?) CommandResult {
            let storage = Directory.CreateDirectory(
                Path.Combine("/tmp", "tokate-omp-" + Guid.NewGuid().ToString("N")),
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
            )
            try {
                let command = Command(executable)
                command.AddRange(arguments)
                return Commands.Run(
                    LocalPaths.NeedSystemTool("env"),
                    command.ToArray(),
                    storage.FullName,
                    seconds: seconds,
                    strictOutput: true,
                    budget: budget
                )
            } finally {
                Directory.Delete(storage.FullName, true)
            }
        }

        internal func Runtime(args Args, budget RuntimeBudget? = nil) JsonElement {
            if !OperatingSystem.IsLinux() || RuntimeInformation.ProcessArchitecture != Architecture.X64 {
                throw Exception("Managed OMP requires Linux x64; no host fallback")
            }
            let found = LocalPaths.Harness("omp", args.Get("harness-path"))
            if found == "" {
                throw Exception(
                    "OMP was not found. Install it with its official installer and sign in, or select --harness-path FILE. No inference started."
                )
            }
            let binary = LocalPaths.CanonicalPath(found)
            if !LocalPaths.Executable(binary) {
                throw Exception("The selected OMP executable is missing or not executable; check --harness-path")
            }
            let result = Native(binary, []string{"--version"}, 30, budget)
            let version = Regex.Match(result.Output.Trim(), "^omp/([0-9]+\\.[0-9]+\\.[0-9]+[A-Za-z0-9.+-]{0,40})\\z")
            if result.Code != 0 || result.Truncated || result.ReadFailed || !version.Success {
                throw LinuxSandbox.ProbeFailure(result, "OMP version check failed; no inference started")
            }
            args.Values["--harness-path"] = binary
            return J.Parse(J.Write(map[string, Object?]{"type": "omp.probe", "version": version.Groups[1].Value}))
        }

        internal func Models(executable string, budget RuntimeBudget? = nil) List[JsonElement] {
            let result = Native(executable, []string{"models", "--json"}, 60, budget)
            if result.Code != 0 || result.Truncated || result.ReadFailed {
                throw Exception("OMP could not list its configured models; run omp models. No inference started")
            }
            let listing = RequestData.Parse(result.Output.Trim(), 16 * 1024 * 1024)
            let models = J.Get(listing, "models")
            if listing.ValueKind != JsonValueKind.Object || models.ValueKind != JsonValueKind.Array {
                throw Exception("OMP returned an unsupported model list; no inference started")
            }
            return J.Items(models)
        }

        internal func Model(executable string, provider string, model string, budget RuntimeBudget? = nil) JsonElement {
            var selected JsonElement
            var matches int32
            for entry in Models(executable, budget) {
                if J.Text(entry, "provider") == provider && J.Text(entry, "id") == model && J.Text(
                    entry,
                    "kind"
                ) == "chat" {
                    selected = entry
                    matches += 1
                }
            }
            if matches != 1 || J.Text(selected, "selector") != provider + "/" + model {
                throw Exception(
                    "OMP does not list exactly one " +
                        provider +
                        "/" +
                        model +
                        " chat model. Check omp models and your OMP sign-in. No inference started"
                )
            }
            let context = J.Get(selected, "contextWindow")
            let output = J.Get(selected, "maxTokens")
            var contextWindow int32
            var maxTokens int32
            if context.ValueKind != JsonValueKind.Number || !context.TryGetInt32(out contextWindow) ||
                contextWindow < 1 ||
                output.ValueKind != JsonValueKind.Number ||
                !output.TryGetInt32(out maxTokens) || maxTokens < 1 {
                throw Exception("OMP reports no usable context or output limit for this model; no inference started")
            }
            return J.Parse(
                J.Write(
                    map[string, Object?]{
                        "provider": provider,
                        "model": model,
                        "contextWindow": contextWindow,
                        "maxTokens": maxTokens,
                        "efforts": Efforts(selected)
                    }
                )
            )
        }

        internal func Efforts(entry JsonElement) List[string] {
            let efforts = List[string]()
            let thinking = J.Get(entry, "thinking")
            if J.Get(entry, "reasoning").ValueKind == JsonValueKind.True && thinking.ValueKind == JsonValueKind.Array {
                efforts.Add("off")
                for level in thinking.EnumerateArray() {
                    if level.ValueKind == JsonValueKind.String {
                        efforts.Add(level.GetString() ?? "")
                    }
                }
            } else {
                efforts.Add("absent")
            }
            return efforts
        }

        internal func CheckEffort(settings JsonElement, effort string) {
            for level in J.Items(J.Get(settings, "efforts")) {
                if level.GetString() == effort {
                    return
                }
            }
            throw Exception(
                "OMP does not support the selected reasoning effort for this model; choose a supported level before starting"
            )
        }
    }
}
