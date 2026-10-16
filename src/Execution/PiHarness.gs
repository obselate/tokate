package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Runtime.InteropServices
import System.Text.Json
import System.Text.RegularExpressions

internal class PiHarness {
    shared {
        private func CliExecutable(path string) bool -> LocalPaths.Executable(path) ||
            (File.Exists(path) && (path.EndsWith(".js") || path.EndsWith(".mjs") || path.EndsWith(".cjs")))

        internal func Activity(line string) {
            let value = J.Parse(line)
            let event = J.Text(value, "type")

            if SessionEvidence.Activity(value) {
                return
            } else if event == "tool_execution_end" {
                for item in J.Items(J.Get(J.Get(value, "result"), "content")) {
                    if J.Text(item, "type") == "text" {
                        Output.Sink.Append(J.Text(item, "text"))
                    }
                }

                if J.Bool(value, "is_error") {
                    Output.Sink.Append("Tool failed: " + J.Text(value, "tool"))
                }
            } else if event == "compaction_end" {
                Output.Sink.Append("Context compacted")
            }
        }

        private func ManagedRuntime(cli string, args Args) string {
            let store = NixRuntime.Root(cli)
            let nixRoot = Path.Combine(store, "lib/pi/node_modules")
            if store != "" && cli == Path.Combine(store, "bin/pi") && Directory.Exists(nixRoot) {
                if args.Get("node") == "" {
                    let nodes = HashSet[string](StringComparer.Ordinal)
                    for path in NixRuntime.Paths([]string{cli}, Directory.GetCurrentDirectory()) {
                        let candidate = Path.Combine(path, "bin/node")
                        if LocalPaths.Executable(candidate) {
                            nodes.Add(LocalPaths.CanonicalPath(candidate))
                        }
                    }

                    if nodes.Count != 1 {
                        throw ExecutionFailure.Create(
                            "invalid_state",
                            "Select --node explicitly; the Pi Nix closure does not identify one Node runtime."
                        )
                    }

                    for node in nodes {
                        args.Values["--node"] = node
                    }
                }
                return nixRoot
            }

            var agent = Directory.GetParent(cli)?.Parent?.FullName ?? ""
            if cli != Path.Combine(agent, "bin/pi") || !File.Exists(
                Path.Combine(agent, "install/managed-install.json")
            ) {
                agent = LocalPaths.PiDirectory()
            }

            let markerPath = Path.Combine(agent, "install/managed-install.json")
            if !File.Exists(markerPath) && FileInfo(markerPath).LinkTarget == nil {
                throw ExecutionFailure.Create(
                    "missing_tools",
                    "Cannot locate the Pi SDK from this launcher. Select its installed node_modules directory with --pi-root."
                )
            }

            let install = LocalPaths.DirectoryPath(Path.Combine(agent, "install"))
            let versionPath = Path.Combine(install, "current-version")
            if FileInfo(markerPath).LinkTarget != nil || FileInfo(versionPath).LinkTarget != nil {
                throw ExecutionFailure.Create("invalid_state", "Pi installation metadata must be regular files")
            }

            let marker = RequestData.FileData(markerPath, 16384)
            let entrypoint = J.Get(marker, "entrypoint")
            let entryPath = J.Text(entrypoint, "path")

            if J.Text(marker, "kind") != "pi-managed-install" || J.Number(marker, "schemaVersion") != 1 || J.Text(
                marker,
                "layout"
            ) != "releases-v1" ||
                (J.Text(entrypoint, "type") != "script" && J.Text(entrypoint, "type") != "symlink") ||
                !Path.IsPathFullyQualified(entryPath) || LocalPaths.CanonicalPath(entryPath) != cli {
                throw ExecutionFailure.Create(
                    "invalid_state",
                    "Unsupported Pi installation metadata; provide --pi-root and --node explicitly"
                )
            }

            if FileInfo(versionPath).Length < 1 || FileInfo(versionPath).Length > 128 {
                throw ExecutionFailure.Create("invalid_state", "Invalid managed Pi version file")
            }

            let version = File.ReadAllText(versionPath)
            if !Regex.IsMatch(version, "^[A-Za-z0-9._+-]+\\r?\\n?\\z") || version.Trim() == "." ||
                version.Trim() == ".." {
                throw ExecutionFailure.Create("invalid_state", "Invalid managed Pi version file")
            }

            if args.Get("node") == "" {
                var data = Environment.GetEnvironmentVariable("XDG_DATA_HOME") ?? ""
                if data == "" {
                    data = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                        ".local/share"
                    )
                }

                let node = Path.Combine(data, "pi-node/current/bin/node")
                if Path.IsPathFullyQualified(data) && LocalPaths.Executable(node) {
                    args.Values["--node"] = node
                }
            }
            return Path.Combine(install, "releases", version.Trim(), "node_modules")
        }

        internal func Runtime(args Args) {
            try {
                if !OperatingSystem.IsLinux() || RuntimeInformation.ProcessArchitecture != Architecture.X64 {
                    throw ExecutionFailure.Create("missing_tools", "Managed pi requires Linux x64; no host fallback")
                }

                if args.Get("harness-path") != "" && !CliExecutable(LocalPaths.RuntimePath(args.Need("harness-path"))) {
                    throw ExecutionFailure.Create(
                        "missing_tools",
                        "The selected Pi executable is missing or not executable; check --harness-path"
                    )
                }

                var root = args.Get("pi-root")
                if root == "" {
                    let executable = LocalPaths.Harness("pi", args.Get("harness-path"))
                    if executable == "" {
                        throw ExecutionFailure.Create(
                            "missing_tools",
                            "Install pi or supply --pi-root pointing to its existing node_modules directory"
                        )
                    }

                    if !CliExecutable(executable) {
                        throw ExecutionFailure.Create(
                            "missing_tools",
                            "The selected Pi executable is missing or not executable; check --harness-path"
                        )
                    }

                    let cli = LocalPaths.CanonicalPath(executable)
                    let installedPackage = Directory.GetParent(cli)?.Parent?.Parent?.FullName ?? ""
                    root = cli == Path.Combine(installedPackage, "dist/bundle/cli.js") && Path.GetFileName(
                        installedPackage
                    ) == "pi-coding-agent" &&
                        Path.GetFileName(Path.GetDirectoryName(installedPackage) ?? "") == "@earendil-works" ?
                    Path.GetDirectoryName(Path.GetDirectoryName(installedPackage) ?? "") ?? "":
                    ManagedRuntime(cli, args)
                }

                root = LocalPaths.DirectoryPath(root)
                if Path.GetFileName(root) != "node_modules" {
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "--pi-root must be an existing node_modules directory, not donor settings"
                    )
                }

                let packagePath = Path.Combine(root, "@earendil-works/pi-coding-agent")
                LocalPaths.DirectoryPath(packagePath)
                let metadata = RequestData.FileData(Path.Combine(packagePath, "package.json"), 128 * 1024)
                if J.Text(metadata, "name") != "@earendil-works/pi-coding-agent" || J.Text(metadata, "version") == "" ||
                    !File
                    .Exists(Path.Combine(packagePath, "dist/index.js")) {
                    throw ExecutionFailure.Create("missing_tools", "The installed pi SDK package layout is required")
                }

                let node = LocalPaths.CanonicalPath(
                    args.Get("node") == "" ? LocalPaths.FindTrusted("node"): args.Need("node")
                )
                if !File.Exists(node) || !Path.IsPathFullyQualified(node) {
                    throw ExecutionFailure.Create(
                        "missing_tools",
                        "An existing Node runtime is required; Tokate never installs one"
                    )
                }

                args.Values["--pi-root"] = root
                args.Values["--node"] = node

                let entry = J.Text(J.Get(metadata, "bin"), "pi")
                let executable = Path.GetFullPath(Path.Combine(packagePath, entry))
                if entry == "" || !LocalPaths.Within(executable, packagePath) || !File.Exists(executable) {
                    throw ExecutionFailure.Create(
                        "missing_tools",
                        "The installed Pi package does not provide its CLI entrypoint"
                    )
                }

                args.Values["--harness-path"] = executable
            } catch (error Exception) when error is IOException ||
                error is UnauthorizedAccessException ||
                error is JsonException {
                throw ExecutionFailure.From(error, "missing_tools")
            }
        }

        internal func Select(args Args, selection Func[Dictionary[string, Object?]]) JsonElement {
            let model = RequestData.ModelIdentifier(args.Need("model"))
            let effort = args.Need("effort")

            let selected = selection()
            let endpoint = PiBoundary.Endpoint(args.Need("endpoint"))
            Runtime(args)
            PiBoundary.Probe(args.Need("pi-root"), args.Need("node"))
            let limits = PiBoundary.ModelSettings(args.Need("pi-root"), args.Need("node"), model, endpoint)
            PiBoundary.CheckEffort(limits, effort)

            let catalog = PiCatalog.Read(args.Need("node"), model, endpoint)

            selected["capability"] = "native Pi CLI with configured tools inside whole-process isolation"
            selected["availability"] = "advertised"
            selected[
                "availability_evidence"
            ] = "Selected endpoint advertises the exact model ID; weights and coding capability are unverified"
            selected["endpoint_catalog"] = catalog
            selected["context_window"] = J.Number(limits, "contextWindow")
            selected["max_tokens"] = J.Number(limits, "maxTokens")
            return J.Parse(J.Write(selected))
        }

        internal func Doctor(options Args, tool ToolCheck) {
            Runtime(options)
            let versions = PiBoundary.Probe(options.Need("pi-root"), options.Need("node"))
            tool.Path = options.Need("pi-root")
            tool.Detail = "Pi " + J.Text(versions, "version") + ", Node " + J.Text(versions, "node") + ". " + Settings()
        }

        private func Settings() string {
            let directory = LocalPaths.PiDirectory()
            let settings = Optional(Path.Combine(directory, "settings.json"))
            let provider = J.Text(settings, "defaultProvider")
            let models = J.Get(Optional(Path.Combine(directory, "models.json")), "providers")

            return "Pi settings: model " +
                Value(J.Text(settings, "defaultModel")) +
                ", effort " +
                Value(J.Text(settings, "defaultThinkingLevel")) +
                ", provider " +
                Value(provider) +
                ", endpoint " +
                Endpoint(J.Text(J.Get(models, provider), "baseUrl")) +
                "."
        }

        private func Optional(path string) JsonElement {
            try {
                return RequestData.FileData(path, 16 * 1024 * 1024)
            } catch (error CliFailure) {
                return JsonElement{}
            }
        }

        private func Value(text string) string -> text == "" ? "not set": text

        private func Endpoint(value string) string {
            var uri Uri

            if !Uri.TryCreate(value, UriKind.Absolute, out uri) {
                return value == "" ? "not set": "invalid"
            }

            return uri.GetComponents(
                UriComponents.SchemeAndServer | UriComponents.Path | UriComponents.KeepDelimiter,
                UriFormat.UriEscaped
            )
        }

        internal func ValidateSaved(run Data) {
            PiBoundary.Endpoint(run.Text("pi_endpoint"))

            let args = Args([]string{"work", "--harness", "pi"})
            args.Values["--pi-root"] = run.Text("pi_root")
            args.Values["--node"] = run.Text("pi_node")
            args.Values["--harness-path"] = run.Text("harness_path")

            Runtime(args)
            if args.Need("pi-root") != run.Text("pi_root") || args.Need("node") != run.Text("pi_node") {
                throw ExecutionFailure.Create("invalid_state", "Saved pi runtime changed; no substitution")
            }
        }

        internal func BeforeRun(run Data, coding RuntimeBudget) {
            run.Fields["failure_stage"] = "endpoint_check"
            run.Fields["failure_reason"] = "endpoint_unavailable"
            let endpoint = PiBoundary.Endpoint(run.Text("pi_endpoint"))
            run.Fields["endpoint_catalog"] = PiCatalog.Read(run.Text("pi_node"), run.Text("model"), endpoint, coding)
        }

        internal func Prepare(
            directory string,
            run Data,
            record JsonElement,
            coding RuntimeBudget,
            models Func[string, string, string, List[string]?]
        ) ValueTuple[[]string, Dictionary[string, Object?]?] {
            let runtime = PiBoundary.Probe(run.Text("pi_root"), run.Text("pi_node"), coding)
            let endpoint = PiBoundary.Endpoint(run.Text("pi_endpoint"))
            let limits = PiBoundary.ModelSettings(
                run.Text("pi_root"),
                run.Text("pi_node"),
                run.Text("model"),
                endpoint,
                coding
            )
            PiBoundary.CheckEffort(limits, run.Text("effort"))

            let args = PiBoundary.Cli(run.Text("harness_path"), run.Text("pi_node"))
            args.AddRange([]string{"--mode", "json", "--provider", J.Text(limits, "provider")})
            args.AddRange([]string{"--model", run.Text("model")})
            args.AddRange([]string{"--thinking", run.Text("effort") == "absent" ? "off": run.Text("effort")})
            let invocation = map[string, Object?]{
                "harness": "pi",
                "sdk_version": J.Text(runtime, "version"),
                "node_version": J.Text(runtime, "node"),
                "provider": J.Text(limits, "provider"),
                "model": run.Text("model"),
                "effort": run.Text("effort"),
                "context_window": J.Number(limits, "contextWindow"),
                "max_tokens": J.Number(limits, "maxTokens")
            }
            return ValueTuple[[]string, Dictionary[string, Object?]?](
                args.ToArray(),
                map[string, Object?]{"pi_version": J.Text(runtime, "version"), "observed_invocation": invocation}
            )
        }

        internal func Read(
            directory string,
            run Data,
            record JsonElement,
            result CommandResult,
            allowsModel Func[string, bool]
        ) Evidence {
            if result.Code != 0 || result.Truncated || result.ReadFailed {
                throw ExecutionFailure.Create(
                    "inference_failed",
                    "Pi did not complete; inspect private captured evidence. No new run was started"
                )
            }
            let evidence = SessionEvidence.Completed(
                result.Output,
                run.Text("model"),
                J.Text(J.Get(run.Element(), "observed_invocation"), "provider")
            )
            run.Fields[
                "usage_provenance"
            ] = "harness-reported; server identity, resources and billing are not independently proven"
            return evidence
        }
    }
}
