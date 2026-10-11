package Tokate

import Gsharp.Concurrency
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Runtime.InteropServices
import System.Text.Json
import System.Text.RegularExpressions

internal class PiHarness {
    shared {
        private func CliExecutable(path string) bool -> LocalPaths.Executable(path) ||
            (File.Exists(path) && (path.EndsWith(".js") || path.EndsWith(".mjs") || path.EndsWith(".cjs")))

        private func Activity(line string) {
            let value = J.Parse(line)
            let event = J.Text(value, "type")
            if event == "message_end" && J.Text(J.Get(value, "message"), "role") == "assistant" {
                for part in J.Items(J.Get(J.Get(value, "message"), "content")) {
                    if J.Text(part, "type") == "text" {
                        DonationView.Append("Assistant: " + J.Text(part, "text"))
                    }
                }
            } else if event == "tool_execution_start" {
                let args = J.Get(value, "args")
                let detail = J.Text(args, "command") == "" ? J.Text(args, "path"): J.Text(args, "command")
                DonationView.Append(J.Text(value, "toolName") + ": " + detail)
            } else if event == "tool_execution_end" {
                for item in J.Items(J.Get(J.Get(value, "result"), "content")) {
                    if J.Text(item, "type") == "text" {
                        DonationView.Append(J.Text(item, "text"))
                    }
                }
                if J.Bool(value, "is_error") {
                    DonationView.Append("Tool failed: " + J.Text(value, "tool"))
                }
            } else if event == "compaction_end" {
                DonationView.Append("Context compacted")
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
                        throw Exception(
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
                throw Exception(
                    "Cannot locate the Pi SDK from this launcher. Select its installed node_modules directory with --pi-root."
                )
            }
            let install = LocalPaths.DirectoryPath(Path.Combine(agent, "install"))
            let versionPath = Path.Combine(install, "current-version")
            if FileInfo(markerPath).LinkTarget != nil || FileInfo(versionPath).LinkTarget != nil {
                throw Exception("Pi installation metadata must be regular files")
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
                throw Exception("Unsupported Pi installation metadata; provide --pi-root and --node explicitly")
            }
            if FileInfo(versionPath).Length < 1 || FileInfo(versionPath).Length > 128 {
                throw Exception("Invalid managed Pi version file")
            }
            let version = File.ReadAllText(versionPath)
            if !Regex.IsMatch(version, "^[A-Za-z0-9._+-]+\\r?\\n?\\z") || version.Trim() == "." ||
                version.Trim() == ".." {
                throw Exception("Invalid managed Pi version file")
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
            if !OperatingSystem.IsLinux() || RuntimeInformation.ProcessArchitecture != Architecture.X64 {
                throw Exception("Managed pi requires Linux x64; no host fallback")
            }
            if args.Get("harness-path") != "" && !CliExecutable(LocalPaths.RuntimePath(args.Need("harness-path"))) {
                throw Exception("The selected Pi executable is missing or not executable; check --harness-path")
            }
            var root = args.Get("pi-root")
            if root == "" {
                let executable = LocalPaths.Harness("pi", args.Get("harness-path"))
                if executable == "" {
                    throw Exception("Install pi or supply --pi-root pointing to its existing node_modules directory")
                }
                if !CliExecutable(executable) {
                    throw Exception("The selected Pi executable is missing or not executable; check --harness-path")
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
                throw Exception("--pi-root must be an existing node_modules directory, not donor settings")
            }
            let packagePath = Path.Combine(root, "@earendil-works/pi-coding-agent")
            LocalPaths.DirectoryPath(packagePath)
            let metadata = RequestData.FileData(Path.Combine(packagePath, "package.json"), 128 * 1024)
            if J.Text(metadata, "name") != "@earendil-works/pi-coding-agent" || J.Text(metadata, "version") == "" ||
                !File
                .Exists(Path.Combine(packagePath, "dist/index.js")) {
                throw Exception("The installed pi SDK package layout is required")
            }
            let node = LocalPaths.CanonicalPath(
                args.Get("node") == "" ? LocalPaths.FindTrusted("node"): args.Need("node")
            )
            if !File.Exists(node) || !Path.IsPathFullyQualified(node) {
                throw Exception("An existing Node runtime is required; Tokate never installs one")
            }
            args.Values["--pi-root"] = root
            args.Values["--node"] = node
            let entry = J.Text(J.Get(metadata, "bin"), "pi")
            let executable = Path.GetFullPath(Path.Combine(packagePath, entry))
            if entry == "" || !LocalPaths.Within(executable, packagePath) || !File.Exists(executable) {
                throw Exception("The installed Pi package does not provide its CLI entrypoint")
            }
            args.Values["--harness-path"] = executable
        }

        internal func Select(args Args, policy Policy, source string) JsonElement {
            if args.Need("provider") != "local-chat-completions" {
                throw Exception("Unsupported pi provider; only local-chat-completions is managed")
            }
            let model = RequestData.ModelIdentifier(args.Need("model"))
            let effort = args.Need("effort")
            policy.ValidatePi(model, effort, 1)
            let endpoint = PiBoundary.Endpoint(args.Need("endpoint"))
            if args.Get("availability") == "unavailable" {
                throw Exception("Selected model is donor-reported unavailable; no retry or fallback")
            }
            Runtime(args)
            PiBoundary.Probe(args.Need("pi-root"), args.Need("node"))
            let limits = PiBoundary.ModelSettings(args.Need("pi-root"), args.Need("node"), model, endpoint)
            PiBoundary.CheckEffort(limits, effort)
            let catalog = PiCatalog.Read(args.Need("node"), model, endpoint)
            return J.Parse(
                J.Write(
                    map[string, Object?]{
                        "harness": "pi",
                        "provider": "local-chat-completions",
                        "model": model,
                        "effort": effort,
                        "source": source,
                        "policy_hash": policy.Digest,
                        "policy_eligible": true,
                        "capability": "native Pi CLI with configured tools inside whole-process isolation",
                        "availability": "advertised",
                        "availability_evidence": "Selected endpoint advertises the exact model ID; weights and coding capability are unverified",
                        "endpoint_catalog": catalog,
                        "context_window": J.Number(limits, "contextWindow"),
                        "max_tokens": J.Number(limits, "maxTokens")
                    }
                )
            )
        }

        internal func ValidateSaved(run Data, policy Policy) {
            policy.ValidatePi(run.Text("model"), run.Text("effort"), run.Number("seconds"))
            PiBoundary.Endpoint(run.Text("pi_endpoint"))
            let args = Args(
                []string{
                    "work",
                    "--harness",
                    "pi",
                    "--pi-root",
                    run.Text("pi_root"),
                    "--node",
                    run.Text("pi_node"),
                    "--harness-path",
                    run.Text("harness_path")
                }
            )
            Runtime(args)
            if args.Need("pi-root") != run.Text("pi_root") || args.Need("node") != run.Text("pi_node") {
                throw Exception("Saved pi runtime changed; no substitution")
            }
        }

        internal func Execute(directory string, run Data, record JsonElement, prompt string) {
            if run.Number("version") != 2 || run.Text("source") != "tokate" || run.Number("preparation_version") != 1 {
                throw Exception("Managed pi requires a prepared version-2 contribution")
            }
            let timer = Stopwatch.StartNew()
            let coding = RuntimeBudget(timer, run.Number("seconds") - run.Number("verification_reserve"))
            WorkspacePreparation.Ready(directory, run)
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
            let checkout = Path.Combine(directory, "checkout")
            let args = PiBoundary.Cli(run.Text("harness_path"), run.Text("pi_node"))
            args.AddRange(
                []string{
                    "--mode",
                    "json",
                    "--provider",
                    J.Text(limits, "provider"),
                    "--model",
                    run.Text("model"),
                    "--thinking",
                    run.Text("effort") == "absent" ? "off": run.Text("effort")
                }
            )
            ContributionAuthority.Recheck(run)
            WorkspacePreparation.Ready(directory, run)
            try {
                run.Fields["failure_stage"] = "endpoint_check"
                run.Fields["failure_reason"] = "endpoint_unavailable"
                run.Fields["endpoint_catalog"] = PiCatalog.Read(
                    run.Text("pi_node"),
                    run.Text("model"),
                    endpoint,
                    coding
                )
                run.Fields["state"] = "running"
                run.Fields["failure_stage"] = "inference"
                run.Fields["failure_reason"] = "inference_failed"
                run.Fields["pi_version"] = J.Text(runtime, "version")
                run.Fields["observed_invocation"] = map[string, Object?]{
                    "harness": "pi",
                    "sdk_version": J.Text(runtime, "version"),
                    "node_version": J.Text(runtime, "node"),
                    "provider": J.Text(limits, "provider"),
                    "model": run.Text("model"),
                    "effort": run.Text("effort"),
                    "context_window": J.Number(limits, "contextWindow"),
                    "max_tokens": J.Number(limits, "maxTokens")
                }
                run.Save(directory)
                PublicOutput.FailureCode = "inference_failed"
                var result CommandResult
                {
                    using let progress = TerminalProgress(
                        "Pi inference",
                        coding,
                        RuntimeBudget(timer, run.Flag("unlimited") ? 0: run.Number("seconds"))
                    )
                    var activity Action[string]? = nil
                    if DonationView.Active() {
                        activity = line -> Activity(line)
                    }
                    result = Commands.Run(
                        LocalPaths.NeedSystemTool("env", checkout),
                        args.ToArray(),
                        checkout,
                        prompt,
                        run.Flag("unlimited") ? 0: run.Number("seconds"),
                        cancellation: Chan[bool](1),
                        strictOutput: true,
                        outputPath: Path.Combine(directory, "events.jsonl"),
                        errorPath: Path.Combine(directory, "stderr.log"),
                        budget: coding,
                        outputLine: activity
                    )
                }
                run.Fields["output_truncated"] = result.OutputTruncated
                run.Fields["error_truncated"] = result.ErrorTruncated
                run.Fields["inference_exit_code"] = result.Code
                if result.Code != 0 || result.Truncated || result.ReadFailed {
                    throw Exception("Pi did not complete; inspect private captured evidence. No new run was started")
                }
                let usage = PiEvidence.Completed(
                    directory,
                    result.Output,
                    run.Text("model"),
                    J.Text(limits, "provider")
                )
                run.Fields["turn_completed"] = true
                run.Fields["usage"] = usage
                run.Fields[
                    "usage_provenance"
                ] = "harness-reported; server identity, resources and billing are not independently proven"
                run.Fields["execution_seconds"] = Convert.ToInt32(timer.Elapsed.TotalSeconds)
                run.Save(directory)
                PublicOutput.FailureCode = "invalid_state"
                Contribution.Finish(
                    directory,
                    run,
                    record,
                    usage,
                    timer,
                    run.Number("seconds"),
                    run.Number("verification_reserve")
                )
            } catch (error Exception) {
                if run.Text("failure_stage") == "inference" {
                    if let result = Commands.InterruptedResult(error) {
                        run.Fields["failure_reason"] = "inference_interrupted"
                        run.Fields["output_truncated"] = result.OutputTruncated
                        run.Fields["error_truncated"] = result.ErrorTruncated
                    }
                }
                run.Fields["state"] = "failed"
                run.Fields["error"] = error.Message
                run.Save(directory)
                throw error
            }
        }
    }
}
