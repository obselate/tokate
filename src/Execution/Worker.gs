package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class Worker {
    shared {
        internal func Config(args List[string], key string, value string) {
            args.Add("-c")
            args.Add(key + "=" + value)
        }

        internal func CodexPath(path string = "") string -> CodexRuntime.Resolve(path)

        internal func Command(args[]string, harnessPath string)[]string {
            let codex = CodexPath(harnessPath)
            let command = List[string]()
            let bubblewrap = CodexRuntime.Bubblewrap(codex)
            if bubblewrap != "" {
                command.Add(
                    "PATH=" + Path.GetDirectoryName(bubblewrap) +
                        ":" +
                        (Environment.GetEnvironmentVariable("PATH") ?? "/usr/bin:/bin")
                )
            }
            command.Add(codex)
            command.AddRange(args)
            return command.ToArray()
        }

        private func Run(directory string, args[]string, harnessPath string) CommandResult {
            let checkout = Path.Combine(directory, "checkout")
            Verification.Validate(checkout)
            return Commands.Run(
                LocalPaths.NeedSystemTool("env", directory),
                Command(args, harnessPath),
                checkout,
                harness: true
            )
        }

        internal func Activity(line string) {
            let value = J.Parse(line)
            let type = J.Text(value, "type")
            let item = J.Get(value, "item")
            let kind = J.Text(item, "type")

            if type == "item.completed" && kind == "agent_message" {
                Output.Sink.Append("Assistant: " + J.Text(item, "text"))
            } else if type == "item.started" && kind == "command_execution" {
                Output.Sink.Append("Run: " + J.Text(item, "command"))
            } else if type == "item.completed" && kind == "command_execution" {
                Output.Sink.Append(J.Text(item, "aggregated_output"))
                Output.Sink.Append(
                    "Command " + J.Text(item, "status") + " (exit " + J.Get(item, "exit_code").ToString() + ")"
                )
            } else if type == "item.completed" && kind == "file_change" {
                for change in J.Items(J.Get(item, "changes")) {
                    Output.Sink.Append(J.Text(change, "kind") + ": " + J.Text(change, "path"))
                }
            } else if type == "error" || type == "turn.failed" {
                Output.Sink.Append(
                    "Harness error: " + J.Text(value, "message") + J.Text(J.Get(value, "error"), "message")
                )
            }
        }

        internal func Filesystem(checkout string, gitRead bool = false, harnessPath string = "") string {
            let gitMode = gitRead ? "read": "deny"
            let codex = CodexPath(harnessPath)
            let paths = NixRuntime.Paths(NixRuntime.Tools(checkout, []string{codex}).ToArray(), checkout)
            var policy = "{ \":root\" = \"deny\", \":minimal\" = \"read\", \"/tmp\" = \"write\", " + J.Write(checkout) +
                " = \"write\", " +
                J.Write(Path.Combine(checkout, ".git")) + " = " + J.Write(gitMode) + ", " + J.Write(codex) +
                " = \"read\""

            let bubblewrap = CodexRuntime.Bubblewrap(codex)
            if bubblewrap != "" {
                policy += ", " + J.Write(bubblewrap) + " = \"read\""
            }

            for path in paths {
                policy += ", " + J.Write(path) + " = \"read\""
            }
            return policy + " }"
        }

        internal func Probe(directory string, checkout string, harnessPath string = "") {
            let sentinel = Path.Combine(directory, "private-probe")
            let args = List[string]{"sandbox", "-P", "tokate", "--include-managed-config", "-C", checkout}
            var failure Exception? = nil
            var scriptIndex int32

            try {
                File.WriteAllText(sentinel, "private")
                Config(args, "permissions.tokate.filesystem", Filesystem(checkout, harnessPath: harnessPath))
                Config(args, "permissions.tokate.network.enabled", "false")
                args.AddRange(
                    []string{
                        "--",
                        LocalPaths.NeedSystemTool("env", checkout),
                        "-i",
                        "PATH=" + NixRuntime.SearchPath(
                            NixRuntime.Tools(checkout, []string{CodexPath(harnessPath)}).ToArray()
                        ),
                        LocalPaths.NeedSystemTool("sh", checkout),
                        "-c",
                        "test ! -r \"$1\" && test ! -r .git/config && probe=$$(mktemp .tokate-probe.XXXXXX) && rm \"$$probe\" && scratch=$$(mktemp /tmp/tokate-probe.XXXXXX) && rm \"$$scratch\" && \"$2\" --version >/dev/null",
                        "probe",
                        sentinel,
                        CodexPath(harnessPath)
                    }
                )
                scriptIndex = args.Count - 4

                let result = Run(directory, args.ToArray(), harnessPath: harnessPath)
                if result.Code != 0 || result.Truncated || result.ReadFailed {
                    throw LinuxSandbox.ProbeFailure(
                        result,
                        "Managed sandbox isolation probe failed. Check native Codex sandbox support and permission profiles. Tokate does not change security settings."
                    )
                }
            } catch (error Exception) when error is CliFailure ||
                error is CommandInterrupted ||
                error.GetType() == typeof(Exception) || error is IOException || error is UnauthorizedAccessException {
                failure = error
            }

            try {
                File.Delete(sentinel)
            } catch (error Exception) when error is IOException || error is UnauthorizedAccessException {
                failure = failure ?? error
            }

            if let error = failure {
                throw ExecutionFailure.From(error)
            }

            if File.Exists(Path.Combine(checkout, "global.json")) {
                args[scriptIndex] = "dotnet msbuild -nologo -version"
                args[scriptIndex + 1] = "toolchain"

                try {
                    let toolchain = Run(directory, args.ToArray(), harnessPath: harnessPath)
                    if toolchain.Code != 0 || toolchain.Truncated || toolchain.ReadFailed {
                        throw ExecutionFailure.Create("missing_tools", "Pinned SDK startup failed")
                    }
                } catch (error Exception) when error is CliFailure ||
                    error is CommandInterrupted ||
                    error.GetType() == typeof(Exception) {
                    throw CliFailure(
                        "missing_tools",
                        "Pinned SDK/MSBuild startup failed. Install the global.json SDK in a standard system path; home-directory tools are unavailable."
                    )
                }
            }
        }

        internal func Doctor(harnessPath string = "") bool {
            let root = Path.Combine("/var/tmp", "tokate-doctor-" + Guid.NewGuid().ToString("N"))
            try {
                Directory.CreateDirectory(
                    root,
                    UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                )
            } catch (error Exception) when error is IOException || error is UnauthorizedAccessException {
                throw CliFailure(
                    "verification_failed",
                    "Cannot prepare the sandbox probe. Ensure /var/tmp exists and is writable."
                )
            }

            let checkout = Path.Combine(root, "checkout")

            try {
                Directory.CreateDirectory(Path.Combine(checkout, ".git"))
                File.WriteAllText(Path.Combine(checkout, ".git", "config"), "private")

                let global = Path.Combine(Directory.GetCurrentDirectory(), "global.json")
                if FileInfo(global).LinkTarget != nil {
                    throw CliFailure(
                        "verification_failed",
                        "Repository global.json must be a regular file, not a symbolic link."
                    )
                }

                let pinned = File.Exists(global)
                if pinned {
                    File.Copy(global, Path.Combine(checkout, "global.json"))
                }

                Probe(root, checkout, harnessPath)
                return pinned
            } finally {
                Directory.Delete(root, true)
            }
        }

        internal func Authenticate(run Data) {
            let harnessPath = run.Text("harness_path")
            let login = Commands.Run(CodexPath(harnessPath), []string{"login", "status"}, harness: true)
            if login.Code != 0 || !(login.Output + login.Error).Contains("Logged in using ChatGPT") {
                throw CliFailure(
                    "authentication_required",
                    "Run codex login with your ChatGPT subscription first",
                    []string{"codex", "login"}
                )
            }

            let version = Commands.Checked(CodexPath(harnessPath), []string{"--version"}, harness: true)
            if !version.StartsWith("codex-cli ") {
                throw ExecutionFailure.Create("missing_tools", "A supported Codex CLI is required")
            }
            run.Fields["codex_version"] = version
        }

        internal func Prepare(
            directory string,
            run Data,
            record JsonElement,
            coding RuntimeBudget,
            models Func[string, string, string, List[string]?]
        ) ValueTuple[[]string, Dictionary[string, Object?]?] {
            let harnessPath = run.Text("harness_path")
            let selected = J.Get(run.Element(), "selection")
            let checkout = Path.Combine(directory, "checkout")
            Probe(directory, checkout, harnessPath)

            let args = List[string]{
                "exec",
                "--json",
                "--color",
                "never",
                "--cd",
                checkout,
                "--model",
                run.Text("model")
            }
            Config(args, "model_reasoning_effort", J.Write(run.Text("effort")))
            Config(args, "model_provider", J.Write(J.Text(selected, "provider")))
            Config(args, "approval_policy", "\"never\"")
            Config(args, "default_permissions", "\"tokate\"")
            Config(args, "permissions.tokate.filesystem", Filesystem(checkout, harnessPath: harnessPath))
            Config(args, "permissions.tokate.network.enabled", "true")
            args.Add("-")
            return ValueTuple[[]string, Dictionary[string, Object?]?](Command(args.ToArray(), harnessPath), nil)
        }

        internal func Read(
            directory string,
            run Data,
            record JsonElement,
            result CommandResult,
            allowsModel Func[string, bool]
        ) Evidence {
            if result.Code != 0 {
                throw CliFailure("inference_failed", "Codex failed. Inspect the private stderr.log artifact.")
            }
            run.Fields["failure_reason"] = "incomplete_turn"

            if result.Truncated {
                throw ExecutionFailure.Create(
                    "inference_failed",
                    "Codex output was truncated; no complete turn evidence"
                )
            }
            return CodexEvidence.Completed(result.Output)
        }
    }
}
