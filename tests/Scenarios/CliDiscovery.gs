package TokateTests

import Gsharp.Concurrency
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Net.Sockets
import System.Runtime.InteropServices
import System.Text
import System.Text.Json.Nodes

@DllImport("libc", EntryPoint: "getsockopt", SetLastError: true)
func DiscoveryPeer(socket int32, level int32, option int32, value[]byte, length[]uint32) int32;

internal class CliDiscovery {
    shared {
        private let Commands[]string = "work claim submit status checks runs pause resume renew release init approve revoke access policy doctor defaults update uninstall overlaps recover-request amend external reconcile authorize-sync revoke-sync coordinator-setup completion help --version coordination request prepare admit coordinate"
            .Split(' ')

        private func Address(root string) UnixDomainSocketEndPoint -> UnixDomainSocketEndPoint(
            "\0tokate-discovery-" + Check.TextHash(root)
        )

        internal func Holder() int32 {
            let root = Directory.GetCurrentDirectory()
            Console.Write("detached-prefix\n")
            Console.Out.Flush()
            Console.Error.Write("detached-error-prefix\n")
            Console.Error.Flush()
            using let socket = Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified)
            socket.Connect(Address(root))
            socket.Send([]byte{1})
            let ack = [1]byte
            Check.That(socket.Receive(ack) == 1, "Missing detached-holder acknowledgement")
            File.WriteAllText(Path.Combine(root, "holder-ready"), "ready")
            select {
                case <- after(TimeSpan.FromSeconds(20.0)) { }
            }
            return 0
        }

        private func Observe(listener Socket, observed Chan[string]) {
            try {
                let clock = Stopwatch.StartNew()
                while !listener.Poll(0, SelectMode.SelectRead) {
                    Check.That(clock.Elapsed.TotalSeconds < 5, "Detached holder did not connect")
                    select {
                        case <- after(TimeSpan.FromMilliseconds(5.0)) { }
                    }
                }
                using let socket = listener.Accept()
                let credentials = [12]byte
                let length = []uint32{12}
                Check.That(
                    DiscoveryPeer(socket.SafeHandle.DangerousGetHandle().ToInt32(), 1, 17, credentials, length) == 0 &&
                        length[0] == 12,
                    "Cannot identify owned holder"
                )
                let pid = BitConverter.ToInt32(credentials, 0).ToString()
                let message = [1]byte
                Check.That(socket.Receive(message) == 1 && message[0] == 1, "Wrong holder readiness")
                let stat = TestProcess.Status("/proc/" + pid + "/stat") ?? throw Exception("Ready holder is absent")
                Check.That(TestProcess.Fields(stat)[3] == pid, "Pipe holder did not leave the original session")
                socket.Send([]byte{1})
                observed <- pid
            } catch (error Exception) {
                observed <- "error: " + error.Message
            }
        }

        private func Collected(pid string) {
            let clock = Stopwatch.StartNew()
            while TestProcess.Status("/proc/" + pid + "/stat") != nil && clock.Elapsed.TotalSeconds < 2 {
                select {
                    case <- after(TimeSpan.FromMilliseconds(5.0)) { }
                }
            }
            Check.That(
                TestProcess.Status("/proc/" + pid + "/stat") == nil,
                "Repository discovery left a detached holder"
            )
        }

        internal func Call(binary string, args[]string, temp Temp, code int32 = 0) Result {
            let result = TestProcess.Run(binary, args, temp.Env, cwd: temp.Root)
            Check.That(result.Code == code, result.Output + result.Error)
            Check.That(!result.Error.Contains("Missing tools"), "Prerequisites checked before validation")
            return result
        }

        private func Checkout(flow NativeFixture, root string, repo string = "owner/project") {
            flow.Git("init", "-q", "-b", "main", root)
            flow.Git("-C", root, "remote", "add", "origin", "https://github.com/" + repo + ".git")
        }

        private func Publish(flow NativeFixture, text string?) {
            let upstream = Path.Combine(flow.Upstream, ".github/tokate.json")
            if text == nil {
                File.Delete(upstream)
            } else {
                File.WriteAllText(upstream, text)
            }
            flow.Git("-C", flow.Upstream, "add", "-A")
            flow.Git(
                "-C",
                flow.Upstream,
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=test@example.test",
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                "Owner policy"
            )
        }

        internal func Setup(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            flow.ReleaseReady(hosted: false)
            let root = Path.Combine(flow.Temp.Root, "adopter")
            let github = Path.Combine(root, ".github")
            let args = []string{
                "init",
                "owner/project",
                "--path",
                root,
                "--model-policy",
                "unrestricted",
                "--verification",
                "[[\"bash\",\"scripts/verify.sh\"]]",
                "--required-checks",
                "[\"verify\"]",
                "--non-interactive",
                "--yes"
            }
            Check.Contains(flow.Call(args, 1, true).Error, "does not exist")
            Directory.CreateDirectory(root)
            Check.Contains(flow.Call(args, 1, true).Error, "is not a Git checkout")
            let other = Path.Combine(flow.Temp.Root, "other")
            Checkout(flow, other, "someone/else")
            let mismatch = List[string](args)
            mismatch[3] = other
            Check.Contains(
                flow.Call(mismatch.ToArray(), 1, true).Error,
                "is a checkout of someone/else, not owner/project"
            )
            Check.That(!Directory.Exists(Path.Combine(other, ".github")), "Mismatched checkout received setup files")
            Checkout(flow, root)
            Check.Contains(flow.Call(args, 1, true).Error, "Bootstrap required")
            Check.That(!Directory.Exists(github), "Failed setup created adopter files")
            flow.Reload()
            flow.State["hosted_workflow"] = JsonValue.Create(true)
            flow.Save()
            flow.Approve()
            flow.Reload()
            let secondIssue = flow.State["issue"]?.DeepClone() ?? throw Exception("Missing issue")
            secondIssue["number"] = JsonValue.Create(2)
            secondIssue["title"] = JsonValue.Create("Second task")
            flow.State["issues"] = Check.Map("1", flow.State["issue"]?.DeepClone(), "2", secondIssue)
            flow.Save()
            flow.Call([]string{"approve", "owner/project#2"}, owner: true)
            let sharedWorkflow = "obselate/tokate/.github/workflows/tokate-shared.yml@"
            flow.State["branch_protection"] = Check.Json(
                "{\"required_status_checks\":{\"strict\":false,\"contexts\":[\"verify\"]}}"
            )
            flow.Save()
            for setting in[]string{"disabled", "local_only", "stale", "empty", "excluded"} {
                flow.Reload()
                flow.State["actions_permissions"] = Check.Map(
                    "enabled",
                    setting != "disabled",
                    "allowed_actions",
                    setting == "local_only" ? "local_only": "selected"
                )
                let patterns = JsonArray()
                if setting == "stale" {
                    patterns.Add(JsonValue.Create(sharedWorkflow + String('b', 40)) as JsonNode)
                }
                if setting == "excluded" {
                    patterns.Add(JsonValue.Create("*") as JsonNode)
                    patterns.Add(JsonValue.Create("!" + sharedWorkflow + "*") as JsonNode)
                }
                flow.State["selected_actions"] = Check.Map("patterns_allowed", patterns)
                flow.Save()
                flow.ResetTraffic()
                let warned = flow.Call(args, owner: true)
                Check.Contains(warned.Output, "Commit and push")
                Check.Contains(warned.Error, "Settings > Actions > General > Actions permissions")
                Check.Contains(warned.Error, setting == "disabled" ? "Enable Actions": sharedWorkflow + String('a', 40))
                flow.Reload()
                var permissionsReads int32
                var selectedReads int32
                for call in flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                    let path = Check.Text(call["path"])
                    if path == "repos/owner/project/actions/permissions" {
                        permissionsReads++
                    }
                    if path == "repos/owner/project/actions/permissions/selected-actions" {
                        selectedReads++
                    }
                }
                Check.That(permissionsReads == 1, "Init did not read Actions permissions exactly once")
                Check.That(
                    selectedReads == (setting == "disabled" || setting == "local_only" ? 0: 1),
                    "Init read the wrong selected Actions settings"
                )
                if setting == "stale" {
                    let jsonArgs = List[string](args)
                    jsonArgs.Add("--json")
                    Directory.Delete(github, true)
                    let json = flow.Call(jsonArgs.ToArray(), owner: true)
                    let report = Check.Envelope(json, "init", "ok")
                    Check.That(Check.Text(report["data"]?["applied"]) == "true", "Actions warning prevented JSON setup")
                    Check.Contains(json.Error, "Settings > Actions > General > Actions permissions")
                    Check.Contains(json.Error, sharedWorkflow + String('a', 40))
                    Directory.Delete(github, true)
                    let env = System.Collections.Generic.Dictionary[string, string](flow.Temp.Env)
                    env["GH_TOKEN"] = "fixture-owner"
                    let screen = TestProcess.Run(
                        "/usr/bin/script",
                        []string{
                            "-q",
                            "-e",
                            "-c",
                            "'" +
                                binary +
                                "' init --path '" +
                                root +
                                "' --plain --model-policy unrestricted --verification '[[\"bash\",\"scripts/verify.sh\"]]' --required-checks '[\"verify\"]'",
                            "/dev/null"
                        },
                        env,
                        "y\n"
                    )
                    Check.Success(screen)
                    Check.Contains(screen.Output, sharedWorkflow + String('a', 40))
                    Check.Contains(screen.Output, "Commit and push")
                }
                Check.That(
                    File.Exists(Path.Combine(github, "tokate.json")) && File.Exists(
                        Path.Combine(github, "workflows/tokate-coordinator.yml")
                    ),
                    "Actions warning prevented setup files"
                )
                flow.Reload()
                for call in flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                    Check.That(Check.Text(call["method"]) == "GET", "Init changed blocked Actions settings")
                }
                Directory.Delete(github, true)
            }
            flow.State["branch_protection"] = nil
            flow.State["selected_actions"] = Check.Map(
                "patterns_allowed",
                Check.Json("[\"" + sharedWorkflow + String('a', 40) + "\"]")
            )
            flow.Save()
            let created = flow.Call(args, owner: true)
            Check.Contains(created.Error, "Re-approve these issues after the policy change is merged: 1, 2")
            Check.Contains(created.Error, "tokate approve owner/project#1")
            Check.Contains(created.Error, "tokate approve owner/project#2")
            Check.Contains(created.Error, "Added ")
            Check.Contains(created.Output, "Commit and push")
            Check.Contains(created.Error, "contents write")
            Check.Contains(created.Error, "tokate/contributions/N")
            let policyPath = Path.Combine(root, ".github/tokate.json")
            let workflowPath = Path.Combine(root, ".github/workflows/tokate-coordinator.yml")
            let original = File.ReadAllText(policyPath)
            var policy = Check.Json(original)
            Check.That(
                Check.Text(policy["eligibility"]) == "trusted" && Check.Text(policy["approval_scope"]) == "task",
                "New setup did not default to task-scoped trusted access"
            )
            Check.That(
                Check.Text(policy["version"]) == "3" &&
                    policy["models"] == nil &&
                    policy["model_policy"] == nil &&
                    policy["allowed_tools"]?[0]?["models"] == nil,
                "Unrestricted setup silently restricted models"
            )
            Check.That(
                Directory.GetFiles(github, "*", SearchOption.AllDirectories).Length == 2,
                "New adopter footprint is not two files"
            )
            let yaml = File.ReadAllText(workflowPath)
            Check.That(
                !yaml.Contains("run:") && !yaml.Contains("checkout") && yaml.Split('\n').Length < 25,
                "Setup copied runtime code"
            )
            Publish(flow, original)
            flow.Approve()
            let staleApproval = flow.Call([]string{"init", "--path", root, "--non-interactive", "--yes"}, owner: true)
            Check.Contains(staleApproval.Error, "tokate approve owner/project#2")
            Check.That(!staleApproval.Error.Contains("Task fields changed."), "Unchanged init reported task changes")
            Check.That(!staleApproval.Error.Contains("Approvals stay valid."), "Unchanged init hid stale approval")
            flow.Call([]string{"approve", "owner/project#2"}, owner: true)
            let unchangedTasks = flow.Call(
                []string{
                    "init",
                    "--path",
                    root,
                    "--eligibility",
                    "open",
                    "--pr-text",
                    "Owner notes",
                    "--non-interactive",
                    "--yes"
                },
                owner: true
            )
            Check.Contains(unchangedTasks.Error, "Approvals stay valid.")
            Check.That(!unchangedTasks.Error.Contains("tokate approve"), "Nontask init asked for new approvals")
            Publish(flow, File.ReadAllText(policyPath))
            let current = Check.Envelope(flow.Call([]string{"status", "owner/project#1", "--json"}), "status", "ok")
            Check.That(
                Check.Text(current["data"]?["work"]?[0]?["approval_status"]) == "current",
                "Nontask init revoked approval"
            )
            File.WriteAllText(policyPath, original)
            Publish(flow, original)
            let repeated = flow.Call([]string{"init", "--path", root, "--non-interactive", "--yes"}, owner: true)
            Check.Contains(repeated.Output, "nothing to commit")
            Check.That(
                File.ReadAllText(policyPath) == original && File.ReadAllText(workflowPath) == yaml,
                "Repeated setup changed owner files"
            )
            File.WriteAllText(workflowPath, yaml.Replace(String('a', 40), String('c', 40)))
            Check.Contains(
                flow.Call([]string{"init", "--path", root, "--non-interactive", "--yes"}, owner: true).Error,
                sharedWorkflow + String('c', 40)
            )
            Check.That(
                File.ReadAllText(workflowPath) == yaml.Replace(String('a', 40), String('c', 40)),
                "Actions warning changed an existing workflow"
            )
            File.WriteAllText(workflowPath, yaml)
            flow.Reload()
            flow.State["selected_actions"] = Check.Map(
                "patterns_allowed",
                Check.Json("[\"Obselate/Tokate/.github/workflows/tokate-shared.yml@*\"]")
            )
            flow.Save()
            flow.Call([]string{"init", "--path", root, "--non-interactive", "--yes"}, owner: true)
            Check.That(File.ReadAllText(workflowPath) == yaml, "Wildcard allowlist changed the pinned workflow")
            flow.Reload()
            flow.State["actions_permissions"] = nil
            flow.State["selected_actions"] = nil
            flow.Save()
            let fresh = Path.Combine(flow.Temp.Root, "fresh")
            Checkout(flow, fresh)
            flow.Call([]string{"init", "owner/project", "--path", fresh, "--non-interactive", "--yes"}, owner: true)
            let freshPolicy = Path.Combine(fresh, ".github/tokate.json")
            Check.That(
                File.ReadAllText(freshPolicy) == original,
                "Setup in a new checkout did not start from the GitHub policy"
            )
            let unpushed = original.Replace("\"max_seconds\": 3600", "\"max_seconds\": 1800")
            Check.That(unpushed != original, "Fixture policy lacks the expected time limit")
            File.WriteAllText(freshPolicy, unpushed)
            Check.Contains(
                flow.Call([]string{"init", "--path", fresh, "--max-time", "900s", "--non-interactive"}, 1, true).Error,
                "differs from the policy on owner/project@main"
            )
            Check.That(File.ReadAllText(freshPolicy) == unpushed, "Setup overwrote an unpushed local policy")
            let renamed = Path.Combine(root, ".github/workflows/owner.yaml")
            File.Move(workflowPath, renamed)
            flow.Call([]string{"init", "owner/project", "--path", root, "--non-interactive", "--yes"}, owner: true)
            Check.That(
                !File.Exists(workflowPath) && File.ReadAllText(renamed) == yaml && Directory.GetFiles(
                    github,
                    "*",
                    SearchOption.AllDirectories
                )
                    .Length == 2,
                "Repeat duplicated renamed owner workflow"
            )
            File.Move(renamed, workflowPath)
            let escaped = "custom owner workflow\n# synthetic-preview-\x1b[31m\n"
            File.WriteAllText(workflowPath, escaped)
            let safePreview = flow.Call(
                []string{"init", "owner/project", "--path", root, "--non-interactive", "--yes", "--plain"},
                owner: true
            )
            Check.That(!safePreview.Error.Contains('\x1b'), "Owner preview emitted terminal control bytes")
            Check.Contains(
                safePreview.Error,
                "Review wiring and permissions against a pinned workflow: tokate coordinator-setup owner/project --output tokate-coordinator.yml."
            )
            Check.That(File.ReadAllText(workflowPath) == escaped, "Preview changed the custom workflow")
            let custom = Path.Combine(root, ".github/tokate-pr.md")
            File.WriteAllText(custom, TestResources.Template("tokate-pr.md") + "Owner customization\n")
            File.WriteAllText(workflowPath, "custom owner workflow\n")
            flow.Call(
                []string{
                    "init",
                    "owner/project",
                    "--path",
                    root,
                    "--model-policy",
                    "whitelist",
                    "--models",
                    "{\"model-a\":[\"low\",\"high\"],\"model-b\":[\"absent\"]}",
                    "--eligibility",
                    "open",
                    "--base-branch",
                    "release",
                    "--max-time",
                    "5400s",
                    "--reservation-time",
                    "300s",
                    "--pr-text",
                    "Literal {{issue}} owner text",
                    "--close-message",
                    "Ask the owner for access.",
                    "--non-interactive",
                    "--yes"
                },
                owner: true
            )
            let restricted = File.ReadAllText(policyPath)
            Publish(flow, restricted)
            policy = Check.Json(restricted)
            Check.That(
                Check.Text(policy["target_branch"]) == "release" && Check.Text(policy["max_seconds"]) == "5400" &&
                    policy["allow_network"] == nil,
                "Noninteractive settings were not applied"
            )
            flow.Call([]string{"init", "owner/project", "--path", root, "--non-interactive", "--yes"}, owner: true)
            Check.That(
                File.ReadAllText(policyPath) == restricted && File.ReadAllText(
                    workflowPath
                ) == "custom owner workflow\n" &&
                    File
                    .ReadAllText(custom).EndsWith("Owner customization\n"),
                "Repeat overwrote customization or restrictions"
            )
            let invalid = []string{"init", "owner/project", "--path", root, "--verification", "[]", "--non-interactive"}
            flow.Call(invalid, 1, true)
            Check.That(File.ReadAllText(policyPath) == restricted, "Invalid policy replaced owner work")
            policy["allowed_tools"] = Check.Json(
                "[{\"harness\":\"claude\",\"provider\":\"anthropic\"},{\"harness\":\"omp\",\"provider\":\"gufo\"}]"
            )
            Publish(flow, policy.ToJsonString())
            File.WriteAllText(policyPath, policy.ToJsonString())
            let toolArgs = List[string]{
                "init",
                "owner/project",
                "--path",
                root,
                "--allowed-tools",
                "pi",
                "--non-interactive",
                "--yes"
            }
            flow.Call(toolArgs.ToArray(), owner: true)
            Publish(flow, File.ReadAllText(policyPath))
            let mixed = Check.Json(File.ReadAllText(policyPath))["allowed_tools"]?.ToJsonString() ?? ""
            for name in[]string{"omp", "pi"} {
                Check.Contains(mixed, "\"harness\":\"" + name + "\"")
            }
            toolArgs[5] = "claude/anthropic,aider/openrouter"
            flow.Call(toolArgs.ToArray(), owner: true)
            Publish(flow, File.ReadAllText(policyPath))
            policy = Check.Json(File.ReadAllText(policyPath))
            let exact = policy["allowed_tools"]?.AsArray() ?? throw Exception("Missing tools")
            Check.That(
                exact.Count == 2 && Check.Text(exact[1]?["harness"]) == "aider",
                "Exact external tools were not selected"
            )
            toolArgs[5] = "codex"
            flow.Call(toolArgs.ToArray(), owner: true)
            Publish(flow, File.ReadAllText(policyPath))
            policy = Check.Json(File.ReadAllText(policyPath))
            let kept = policy["allowed_tools"]?.AsArray() ?? throw Exception("Missing tools")
            Check.That(
                kept.Count == 2 && Check.Text(kept[0]?["harness"]) == "aider",
                "Managed selection removed external permissions"
            )
            let beforeInvalidTool = File.ReadAllText(policyPath)
            flow.Call(
                []string{"init", "owner/project", "--path", root, "--eligibility", "manual", "--non-interactive"},
                1,
                true
            )
            Check.That(File.ReadAllText(policyPath) == beforeInvalidTool, "Removed eligibility mode changed policy")
            toolArgs[5] = "claude/"
            flow.Call(toolArgs.ToArray(), 1, true)
            Check.That(File.ReadAllText(policyPath) == beforeInvalidTool, "Invalid tool pair changed policy")
            let obsolete = Path.Combine(flow.Temp.Root, "obsolete")
            Checkout(flow, obsolete)
            let obsoletePolicy = Check.Json(TestResources.Template("tokate.json"))
            obsoletePolicy["version"] = JsonValue.Create(1)
            Publish(flow, obsoletePolicy.ToJsonString())
            flow.Call([]string{"init", "owner/project", "--path", obsolete, "--non-interactive"}, 1, true)
            Check.That(
                !File.Exists(Path.Combine(obsolete, ".github/tokate.json")),
                "Unsupported GitHub policy was rewritten"
            )
            let legacy = Check.Json(original)
            legacy["version"] = JsonValue.Create(2)
            legacy["eligibility"] = JsonValue.Create("manual")
            legacy["model_policy"] = JsonValue.Create("whitelist")
            legacy["models"] = Check.Json("{\"model-a\":[\"high\"]}")
            legacy["allowed_tools"] = Check.Json(
                "[{\"harness\":\"claude\",\"provider\":\"anthropic\"},{\"harness\":\"omp\",\"provider\":\"openrouter\"}]"
            )
            Publish(flow, legacy.ToJsonString())
            Check.Contains(flow.Call([]string{"policy", "owner/project"}, 1).Error, "tokate init OWNER/REPO")
            flow.NoInference()
            File.WriteAllText(policyPath, legacy.ToJsonString())
            flow.Call([]string{"init", "owner/project", "--path", root, "--non-interactive", "--yes"}, owner: true)
            let migrated = Check.Json(File.ReadAllText(policyPath))
            Check.That(
                Check.Text(migrated["version"]) == "3" && Check.Text(migrated["eligibility"]) == "trusted" &&
                    migrated["models"] == nil &&
                    migrated["model_policy"] == nil &&
                    migrated["allowed_tools"]?[0]?["models"]?.ToJsonString() == legacy["models"]?.ToJsonString() &&
                    migrated["allowed_tools"]?[1]?["models"]?.ToJsonString() == legacy["models"]?.ToJsonString(),
                "Version 2 migration changed model permissions or lost trusted eligibility"
            )
            Publish(flow, File.ReadAllText(policyPath))
            let routes = "[{\"harness\":\"claude\",\"provider\":\"anthropic\",\"models\":{\"claude-opus-5-5\":[\"high\"]}},{\"harness\":\"omp\",\"provider\":\"openrouter\"}]"
            flow.Call(
                []string{
                    "init",
                    "owner/project",
                    "--path",
                    root,
                    "--allowed-tools",
                    routes,
                    "--non-interactive",
                    "--yes"
                },
                owner: true
            )
            let routed = File.ReadAllText(policyPath)
            Check.That(Check.Json(routed)["allowed_tools"]?.ToJsonString() == routes, "Init lost per-tool model maps")
            Publish(flow, routed)
            flow.Call([]string{"init", "owner/project", "--path", root, "--non-interactive", "--yes"}, owner: true)
            Check.That(File.ReadAllText(policyPath) == routed, "Repeat changed per-tool models")
            Publish(flow, nil)
            let interactiveRoot = Path.Combine(flow.Temp.Root, "interactive")
            Checkout(flow, interactiveRoot)
            Check.Contains(
                flow.Call([]string{"init", "owner/project", "--path", interactiveRoot, "--non-interactive"}, 1, true)
                    .Error,
                "Choose --model-policy"
            )
            for missing in[]string{"events", "pull-requests", "both"} {
                flow.Reload()
                flow.State["actions_policies"] = missing == "pull-requests" ? nil:
                Check.Map("total_count", 0, "policies", JsonArray())
                flow.State["workflow_permissions"] = Check.Map(
                    "default_workflow_permissions",
                    "read",
                    "can_approve_pull_request_reviews",
                    missing == "events"
                )
                flow.State["api_calls"] = JsonArray()
                flow.Save()
                let blocked = flow.Call(
                    []string{
                        "init",
                        "--path",
                        interactiveRoot,
                        "--model-policy",
                        "unrestricted",
                        "--verification",
                        "[[\"/usr/bin/true\"]]",
                        "--required-checks",
                        "[\"verify\"]"
                    },
                    1,
                    true
                )
                Check.Contains(blocked.Error, "Missing GitHub settings")
                Check.Contains(blocked.Error, "--yes")
                if missing != "pull-requests" {
                    Check.Contains(blocked.Error, "Actions event policy")
                }
                if missing != "events" {
                    Check.Contains(blocked.Error, "Allow GitHub Actions to create and approve pull requests")
                }
                Check.That(
                    !Directory.Exists(Path.Combine(interactiveRoot, ".github")),
                    "Missing settings wrote setup files"
                )
                flow.Reload()
                for call in flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                    Check.That(Check.Text(call["method"]) == "GET", "Noninteractive setup changed GitHub settings")
                }
            }
            let savedOwnerToken = flow.Temp.Env["GH_TOKEN"]
            flow.Temp.Env["GH_TOKEN"] = "fixture-owner"
            let setupArgs = []string{
                "init",
                "owner/project",
                "--path",
                interactiveRoot,
                "--model-policy",
                "unrestricted",
                "--verification",
                "[[\"/usr/bin/true\"]]",
                "--required-checks",
                "[\"verify\"]"
            }
            let declinedSetup = TestTerminal.Pty(binary, setupArgs, flow.Temp, 80, "\n")
            Check.That(declinedSetup.Code == 1, declinedSetup.Output + declinedSetup.Error)
            Check.Contains(declinedSetup.Output, "Apply this project setup? [y/N]")
            flow.Reload()
            for call in flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                Check.That(Check.Text(call["method"]) == "GET", "Declined setup changed GitHub settings")
            }
            Check.That(!Directory.Exists(Path.Combine(interactiveRoot, ".github")), "Declined setup wrote files")
            let acceptedSetup = TestTerminal.Pty(binary, setupArgs, flow.Temp, 80, "y\n")
            Check.Success(acceptedSetup)
            Check.That(
                acceptedSetup.Output.Split("Apply this project setup? [y/N]").Length == 2,
                "Setup did not ask once"
            )
            Check.That(
                File.Exists(Path.Combine(interactiveRoot, ".github/tokate.json")),
                "Accepted setup wrote no policy"
            )
            Directory.Delete(Path.Combine(interactiveRoot, ".github"), true)
            flow.Temp.Env["GH_TOKEN"] = savedOwnerToken
            flow.Call(
                []string{
                    "init",
                    "owner/project",
                    "--path",
                    interactiveRoot,
                    "--yes",
                    "--verification",
                    "[[\"/bin/sh\",\"-c\",\"/usr/bin/true\"]]",
                    "--required-checks",
                    "[\"verify\",\"build\"]",
                    "--base-branch",
                    "release",
                    "--max-time",
                    "2h",
                    "--reservation-time",
                    "30m",
                    "--pr-text",
                    "Owner notes",
                    "--allowed-tools",
                    "[{\"harness\":\"codex\",\"provider\":\"openai\",\"models\":{\"model-a\":[\"high\",\"xhigh\"]}},{\"harness\":\"claude\",\"provider\":\"anthropic\"},{\"harness\":\"pi\",\"provider\":\"local-chat-completions\"}]"
                },
                owner: true
            )
            flow.Reload()
            Check.That(
                flow.State["branch_protection"]?.ToJsonString() ==
                "{\"required_status_checks\":{\"strict\":false,\"contexts\":[\"verify\",\"build\"]},\"enforce_admins\":false,\"required_pull_request_reviews\":null,\"restrictions\":null}",
                "Setup did not require the policy checks with the exact protection settings"
            )
            let eventPolicy = Check.Map(
                "name",
                "Tokate coordinator events",
                "enforcement",
                "active",
                "conditions",
                Check.Map(
                    "workflow_path",
                    Check.Map(
                        "include",
                        Check.Json("[\".github/workflows/tokate-coordinator.yml\"]"),
                        "exclude",
                        JsonArray()
                    )
                ),
                "rules",
                Check.Json(
                    "[{\"type\":\"restrict_action_events\",\"parameters\":{\"allowed_events\":[\"issues\",\"issue_comment\",\"pull_request_target\",\"workflow_call\"]}}]"
                )
            )
            Check.That(
                flow.State["actions_policy"]?.ToJsonString() == eventPolicy.ToJsonString(),
                "Setup created the wrong Actions event policy"
            )
            Check.That(
                Check.Text(flow.State["workflow_permissions"]?["default_workflow_permissions"]) == "read" && Check.Text(
                    flow.State["workflow_permissions"]?["can_approve_pull_request_reviews"]
                ) == "true",
                "Setup did not enable PR creation while preserving workflow permissions"
            )
            Check.That(
                File.Exists(Path.Combine(interactiveRoot, ".github/tokate.json")),
                "Explicit confirmation did not apply setup"
            )
            let selected = Check.Json(File.ReadAllText(Path.Combine(interactiveRoot, ".github/tokate.json")))
            Check.That(
                Check.Text(selected["max_seconds"]) == "7200" && Check.Text(selected["reservation_seconds"]) == "1800",
                "Flag setup did not accept times with units"
            )
            Check.That(
                Check.Text(selected["version"]) == "3" &&
                    selected["models"] == nil &&
                    selected["allowed_tools"]?[0]?["models"]?.ToJsonString() == "{\"model-a\":[\"high\",\"xhigh\"]}" &&
                    selected["verification"]?.ToJsonString() == "[[\"/bin/sh\",\"-c\",\"/usr/bin/true\"]]" &&
                    selected["required_checks"]?.ToJsonString() == "[\"verify\",\"build\"]",
                "Flag setup lost selected models, commands or check names"
            )
            Check.That(
                Check.Text(selected["target_branch"]) == "release" && Check.Text(
                    selected["pr_text"]
                ) == "Owner notes" &&
                    selected["allowed_tools"]?.ToJsonString() ==
                "[{\"harness\":\"codex\",\"provider\":\"openai\",\"models\":{\"model-a\":[\"high\",\"xhigh\"]}},{\"harness\":\"claude\",\"provider\":\"anthropic\"},{\"harness\":\"pi\",\"provider\":\"local-chat-completions\"}]",
                "Init lost branch, PR text or tool choices"
            )
            Publish(flow, File.ReadAllText(Path.Combine(interactiveRoot, ".github/tokate.json")))
            let savedToken = flow.Temp.Env["GH_TOKEN"]
            flow.Temp.Env["GH_TOKEN"] = "fixture-owner"
            for flag in[]string{"", "--non-interactive", "--json", "redirected"} {
                flow.Reload()
                flow.State["api_calls"] = JsonArray()
                flow.Save()
                let optionRoot = Path.Combine(flow.Temp.Root, "options-" + flag.Replace('-', '_'))
                Checkout(flow, optionRoot)
                let optionArgs = List[string]{
                    "init",
                    "owner/project",
                    "--path",
                    optionRoot,
                    "--model-policy",
                    "whitelist",
                    "--models",
                    "{\"model-a\":[\"high\"]}",
                    "--allowed-tools",
                    "claude/anthropic,aider/openrouter",
                    "--eligibility",
                    "open",
                    "--base-branch",
                    "release",
                    "--max-time",
                    "20m",
                    "--reservation-time",
                    "30m",
                    "--verification",
                    "[[\"/usr/bin/true\"]]",
                    "--required-checks",
                    "[\"verify\"]",
                    "--pr-text",
                    "Option notes",
                    "--close-message",
                    "Request access.",
                    "--plain"
                }
                if flag.StartsWith("--") {
                    optionArgs.Add(flag)
                }
                let preview = flag == "redirected" ? flow.Call(optionArgs.ToArray(), owner: true):
                TestTerminal.Pty(binary, optionArgs.ToArray(), flow.Temp, 80, flag == "" ? "\n": "")
                Check.That(preview.Code == (flag == "" ? 1: 0), preview.Output + preview.Error)
                if flag == "--json" {
                    Check.That(
                        Check.Text(Check.Envelope(preview, "init", "ok")["data"]?["applied"]) == "false",
                        "Preview claimed setup was applied"
                    )
                }
                Check.Contains(
                    preview.Output +
                        preview.Error +
                        (flag == "--json" ? File.ReadAllText(Path.Combine(flow.Temp.Root, "diagnostics")): ""),
                    "--yes"
                )
                Check.That(!File.Exists(Path.Combine(optionRoot, ".github/tokate.json")), "Preview wrote policy")
                flow.Reload()
                for call in flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                    Check.That(Check.Text(call["method"]) == "GET", "Preview changed GitHub settings")
                }
                if flag != "" {
                    optionArgs.Add("--yes")
                }
                let options = flag == "redirected" ? flow.Call(optionArgs.ToArray(), owner: true):
                TestTerminal.Pty(binary, optionArgs.ToArray(), flow.Temp, 80, flag == "" ? "y\n": "")
                Check.Success(options)
                Check.That(
                    !options.Output.Contains("Who can contribute?") && !options.Output.Contains(
                        "Choose how much control"
                    ) &&
                        !options
                        .Output
                        .Contains("Shell command:") && !options.Output.Contains("Check names:"),
                    "Explicit options still prompted for policy fields"
                )
                let configured = Check.Json(File.ReadAllText(Path.Combine(optionRoot, ".github/tokate.json")))
                Check.That(
                    Check.Text(configured["version"]) == "3" &&
                        configured["model_policy"] == nil &&
                        configured["models"] == nil &&
                        configured["allowed_tools"]?[0]?["models"]?.ToJsonString() == "{\"model-a\":[\"high\"]}" &&
                        Check.Text(configured["eligibility"]) == "open" && Check.Text(
                        configured["target_branch"]
                    ) == "release" &&
                        Check.Text(configured["max_seconds"]) == "1200" && Check.Text(
                        configured["reservation_seconds"]
                    ) == "1800" &&
                        configured["verification"]?.ToJsonString() == "[[\"/usr/bin/true\"]]" &&
                        configured["required_checks"]?.ToJsonString() == "[\"verify\"]" &&
                        configured["allowed_tools"]?.ToJsonString() ==
                    "[{\"harness\":\"claude\",\"provider\":\"anthropic\",\"models\":{\"model-a\":[\"high\"]}},{\"harness\":\"aider\",\"provider\":\"openrouter\",\"models\":{\"model-a\":[\"high\"]}}]" &&
                        Check.Text(configured["pr_text"]) == "Option notes" && Check.Text(
                        configured["close_message"]
                    ) == "Request access.",
                    "Init changed explicit policy options"
                )
                flow.Reload()
                for call in flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                    Check.That(
                        !Check.Text(call["path"]).Contains("/check-runs"),
                        "Explicit check names triggered discovery"
                    )
                }
            }
            flow.Temp.Env["GH_TOKEN"] = savedToken
            flow.Call([]string{"defaults", "set", "--model", "gpt-6.1-sol", "--effort", "high"})
            flow.Call(
                []string{
                    "defaults",
                    "set",
                    "local",
                    "--harness",
                    "pi",
                    "--model",
                    "local-" + String('x', 120),
                    "--effort",
                    "absent",
                    "--endpoint",
                    "http://127.0.0.1:12345/v1"
                }
            )
            flow.NoInference()
            flow.NoPr()
            Console.WriteLine(
                "PASS CLI owner setup: checkout identity, GitHub policy source, direct writes, two files, repeat, restrictions, upgrade and explicit options"
            )
        }

        internal func Structured(binary string) {
            using let temp = Temp()
            let bin = Path.Combine(temp.Root, "bin")
            let calls = Path.Combine(temp.Root, "calls")
            for name in[]string{"git", "gh", "codex", "setsid"} {
                let tool = Path.Combine(bin, name)
                File.WriteAllText(
                    tool,
                    "#!/bin/sh\necho called >> '" + calls + "'\necho synthetic-tool-error-marker >&2\nexit 17\n"
                )
                File.SetUnixFileMode(tool, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute)
            }
            for command in Commands {
                let help = Check.Envelope(Call(binary, []string{command, "--help", "--json"}, temp), command, "ok")
                if command != "help" {
                    Check.That(
                        Check.Text(help["data"]?["commands"]?[0]?["command"]) == command,
                        "Focused metadata missing command"
                    )
                }
            }
            let metadata = Check.Envelope(Call(binary, []string{"help", "--json"}, temp), "help", "ok")
            Check.That(
                metadata["data"]?["commands"]?.AsArray().Count == Commands.Length,
                "Metadata omits public commands"
            )
            for command in metadata["data"]?["commands"]?.AsArray() ?? JsonArray() {
                let names = HashSet[string](StringComparer.Ordinal)
                for option in command["arguments"]?.AsArray() ?? JsonArray() {
                    Check.That(names.Add(Check.Text(option["name"])), "CLI metadata repeated an option")
                }
                Check.That(Check.Text(command["noninteractive"]) == "true", "Hidden interactive command")
                Check.That(
                    Check.Text(command["inference"]) == (Check.Text(command["command"]) == "work" ? "true": "false"),
                    "Incorrect inference effects"
                )
                Check.That(command["effects"]?.AsObject().Count == 4, "Incomplete read/write effects")
            }
            Check.That(
                metadata["data"]?["global_arguments"]?.ToJsonString().Contains("--json") == true,
                "JSON absent from accepted arguments"
            )
            for argv in[][]string{
                []string{"unknown", "--json"},
                []string{"work", "--unknown", "--json"},
                []string{"checks", "--run", "saved", "owner/project#10", "--json"},
                []string{"doctor", "--json=true"},
                []string{"status", "--run", "saved", "--json", "--json"},
                []string{"status", "--run", "saved", "owner/project#10", "--json"},
                []string{"status", "--run", "saved", "1", "--json"},
                []string{"amend", "--run", "saved", "--commit", String('a', 40) + "\n", "--time", "30s", "--json"},
                []string{"revoke-sync", "owner/project", "--grant", "invalid", "--json"},
                []string{"revoke-sync", "owner/project", "--grant", String('a', 40) + "\n", "--json"},
                []string{
                    "authorize-sync",
                    "owner/project#10",
                    "--commit",
                    String('a', 40),
                    "--upstream",
                    "invalid",
                    "--json"
                },
                []string{
                    "authorize-sync",
                    "owner/project#10",
                    "--commit",
                    String('a', 40),
                    "--upstream",
                    String('a', 40) + "\n",
                    "--json"
                },
                []string{
                    "amend",
                    "--run",
                    "saved",
                    "--commit",
                    String('a', 40),
                    "--time",
                    "30s",
                    "--sync",
                    "invalid",
                    "--json"
                },
                []string{
                    "amend",
                    "--run",
                    "saved",
                    "--commit",
                    String('a', 40),
                    "--time",
                    "30s",
                    "--sync",
                    String('a', 40) + "\n",
                    "--json"
                },
                []string{"approve", "0", "--json"},
                []string{"approve", "owner/project", "--json"},
                []string{"approve", "owner/project#1", "--title", "Removed", "--json"},
                []string{"doctor", "--set-default", "--json"}
            } {
                Check.Envelope(Call(binary, argv, temp, 1), argv[0], "error", "invalid_arguments")
            }
            Check.That(!File.Exists(calls), "Invalid inputs or metadata invoked prerequisites")
            let version = Check.Envelope(Call(binary, []string{"--version", "--json"}, temp), "--version", "ok")
            Check.That(
                Call(binary, []string{"--version"}, temp).Output.Trim() == "tokate " + Check.Text(
                    version["data"]?["version"]
                ),
                "Structured and plain versions differ"
            )
            let alias = Check.Json(Call(binary, []string{"version", "--json"}, temp).Output)
            Check.That(JsonNode.DeepEquals(alias, version), "Version alias result differs")
            Check.That(
                Call(binary, []string{"version"}, temp).Output.Trim() == "tokate " + Check.Text(
                    version["data"]?["version"]
                ),
                "Plain version alias differs"
            )
            Check.Contains(Call(binary, []string{"version", "--help"}, temp).Output, "Usage: tokate --version")
            Check.Envelope(
                Call(binary, []string{"version", "extra", "--json"}, temp, 1),
                "--version",
                "error",
                "invalid_arguments"
            )
            let defaults = Check.Envelope(Call(binary, []string{"help", "defaults", "--json"}, temp), "help", "ok")[
                "data"
            ]?["commands"]?[0]
            Check.That(Check.Text(defaults?["effects"]?["local_write"]) == "true", "Defaults write effect missing")
            Check.That(
                JsonNode.DeepEquals(
                    defaults?["operations"]?[0]?["required_input_sets"],
                    Check.Json("[[\"harness\"],[\"model\",\"effort\"]]")
                ),
                "Defaults set required inputs differ"
            )
            Check.That(
                Check.Text(defaults?["operations"]?[1]?["effects"]?["local_write"]) == "false",
                "Defaults read advertised a write"
            )
            for name in[]string{"defaults", "amend", "request"} {
                let command = Check.Envelope(Call(binary, []string{"help", name, "--json"}, temp), "help", "ok")[
                    "data"
                ]?["commands"]?[0]
                Check.That(
                    Check.Text(command?["effects"]?["local_write"]) == "true" && Check.Text(
                        command?["effects"]?["github_read"]
                    ) == "true",
                    "Missing command write effects"
                )
                Check.That(Check.Text(command?["inference"]) == "false", "Non-inference command advertised inference")
            }
            let workMetadata = Check.Envelope(Call(binary, []string{"help", "work", "--json"}, temp), "help", "ok")
            for name in[]string{"time", "runs", "fork", "verify-time"} {
                var listed bool
                for input in workMetadata["data"]?["commands"]?[0]?["exclusive_run_inputs"]?.AsArray() ?? JsonArray() {
                    listed = listed || Check.Text(input) == name
                }
                Check.That(listed, "Metadata omitted --run conflict: " + name)
                let argv = []string{"work", "--run", "saved", "--" + name, "1s", "--json"}
                let rejected = Check.Envelope(Call(binary, argv, temp, 1), "work", "error", "invalid_arguments")
                Check.Contains(Check.Text(rejected["error"]?["message"]), "--run conflicts with --" + name)
            }
            Check.Envelope(
                Call(binary, []string{"checks", "--run", "saved", "--watch", "--timeout", "1s", "--json"}, temp, 1),
                "checks",
                "error",
                "invalid_state"
            )
            Check.Envelope(
                Call(binary, []string{"work", "--run", "saved", "--yes", "--non-interactive", "--json"}, temp, 1),
                "work",
                "error",
                "invalid_state"
            )
            var longPath = "/tmp"
            for i in 0 ... 27 {
                longPath += "/synthetic-" + String('x', 80)
            }
            Check.Contains(Call(binary, []string{"status", "--run", longPath}, temp, 1).Error, longPath)
            Check.Envelope(
                Call(binary, []string{"status", "--run", longPath, "--json"}, temp, 1),
                "status",
                "error",
                "invalid_state"
            )
            for shell in[]string{"bash", "zsh", "fish"} {
                let script = Check.Envelope(
                    Call(binary, []string{"completion", shell, "--json"}, temp),
                    "completion",
                    "ok"
                )
                Check.That(
                    Check.Text(script["data"]?["script"]) == Call(binary, []string{"completion", shell}, temp).Output,
                    "Completion script was shortened"
                )
                Check.That(Check.Text(script["truncated"]) == "false", "Completion was truncated")
            }
            let brokenDoctor = TestProcess.Run(binary, []string{"doctor", "--json"}, temp.Env)
            let broken = Check.Envelope(brokenDoctor, "doctor", "error", "missing_tools")
            Check.That(Check.Text(broken["data"]?["tools"]?[0]?["status"]) == "failed", "Broken tool accepted")
            Check.That(
                !(brokenDoctor.Output + brokenDoctor.Error).Contains("synthetic-tool-error-marker"),
                "Raw diagnostic output leaked"
            )
            let empty = Path.Combine(temp.Root, "empty")
            Directory.CreateDirectory(empty)
            temp.Env["PATH"] = empty
            let doctor = TestProcess.Run(binary, []string{"doctor", "--json"}, temp.Env)
            let diagnosis = Check.Envelope(doctor, "doctor", "error", "missing_tools")
            Check.That(diagnosis["data"]?["tools"]?.AsArray().Count == 8, "Doctor omitted common checks")
            Check.That(!doctor.Output.Contains("Tokate environment"), "Doctor emitted prose stdout")
            let blocked = Check.Envelope(
                TestProcess.Run(binary, []string{"policy", "owner/project", "--json"}, temp.Env),
                "policy",
                "error",
                "missing_tools"
            )
            Check.That(Check.Text(blocked["next_actions"]?[0]?[1]) == "doctor", "Missing-tools action absent")
            let init = Path.Combine(temp.Root, "project")
            Check.Envelope(
                TestProcess.Run(binary, []string{"init", "owner/project", "--path", init, "--json"}, temp.Env),
                "init",
                "error",
                "missing_tools"
            )
            Check.That(!File.Exists(Path.Combine(init, ".github/tokate.json")), "Failed setup wrote configuration")
            let saved = Path.Combine(temp.Root, "saved")
            Directory.CreateDirectory(saved)
            let rows = JsonArray()
            for i in 0 ... 70 {
                rows.Add(
                    Check.Map(
                        "command",
                        Check.Json("[\"/bin/sh\",\"-c\",\"exit 23\"]"),
                        "exit_code",
                        23,
                        "output",
                        "synthetic-verifier-output-marker",
                        "error",
                        "synthetic-verifier-error-marker"
                    )
                )
            }
            let fullArgs = JsonArray()
            for i in 0 ... 100 {
                fullArgs.Add(JsonValue.Create("complete-argument-" + i.ToString()) as JsonNode)
            }
            let firstRow = rows[0] ?? throw Exception("Missing verification row")
            firstRow["command"] = fullArgs
            let hash = String('a', 40)
            let identity = String('x', 3000)
            let record = Check.Map(
                "version",
                2,
                "id",
                "saved",
                "state",
                "failed",
                "commit",
                hash,
                "donor",
                identity,
                "verification",
                rows,
                "error",
                "synthetic-saved-error-marker" + String('x', 20000)
            )
            File.WriteAllText(Path.Combine(saved, "run.json"), record.ToJsonString())
            File.WriteAllText(Path.Combine(saved, "events.jsonl"), "synthetic-harness-marker")
            File.WriteAllText(Path.Combine(saved, "verification.json"), rows.ToJsonString())
            let statusResult = TestProcess.Run(binary, []string{"status", "--run", saved, "--json"}, temp.Env)
            let status = Check.Envelope(statusResult, "status", "ok")
            Check.That(
                status["data"]?["verification"]?.AsArray().Count == 64 && Check.Text(
                    status["data"]?["verification_count"]
                ) == "70",
                "Summary list bounds missing"
            )
            Check.That(Check.Text(status["truncated"]) == "true", "Missing truncation signal")
            Check.That(
                status["data"]?["verification"]?[0]?["command"]?.AsArray().Count == 100,
                "Executable arguments were shortened"
            )
            Check.That(
                Check.Text(status["data"]?["commit"]) == hash && Check.Text(status["data"]?["donor"]) == identity,
                "Identity shortened"
            )
            Check.That(
                Check.Text(status["data"]?["artifacts"]?["events.jsonl"]) == Path.Combine(saved, "events.jsonl"),
                "Missing full artifact path. Expected " + Path.Combine(saved, "events.jsonl") +
                    "\n" +
                    statusResult.Output
            )
            Check.That(Check.Text(status["next_actions"]?[0]?[3]) == saved, "Action path shortened")
            let legacy = TestProcess.Run(binary, []string{"status", "--run", saved}, temp.Env)
            Check.Success(legacy)
            Check.That(Check.Json(legacy.Output)["schema_version"] == nil, "Legacy status was enveloped")
            Check.That(
                Check.Json(legacy.Output)["verification"]?[0]?.AsObject().Count == 2,
                "Legacy verification exposes logs"
            )
            for marker in[]string{
                "synthetic-verifier-output-marker",
                "synthetic-verifier-error-marker",
                "synthetic-saved-error-marker",
                "synthetic-harness-marker"
            } {
                Check.That(
                    !(statusResult.Output + statusResult.Error + legacy.Output + legacy.Error).Contains(marker),
                    "Raw marker escaped summary: " + marker
                )
            }
            firstRow.AsObject().Remove("exit_code")
            firstRow["state"] = JsonValue.Create("interrupted")
            firstRow["output_truncated"] = JsonValue.Create(true)
            firstRow["error_truncated"] = JsonValue.Create(false)
            record["verification"] = rows.DeepClone()
            record["failure_reason"] = JsonValue.Create("inference_interrupted")
            record["output_truncated"] = JsonValue.Create(true)
            File.WriteAllText(Path.Combine(saved, "run.json"), record.ToJsonString())
            let stoppedResult = TestProcess.Run(binary, []string{"status", "--run", saved, "--json"}, temp.Env)
            let stopped = Check.Envelope(stoppedResult, "status", "ok")
            let stoppedCheck = stopped["data"]?["verification"]?[0] ?? throw Exception("Missing interrupted check")
            Check.That(
                Check.Text(stoppedCheck["state"]) == "interrupted" && stoppedCheck["exit_code"] == nil && Check.Text(
                    stoppedCheck["output_truncated"]
                ) == "true" &&
                    Check.Text(stoppedCheck["error_truncated"]) == "false",
                "Incomplete verification acquired an exit code or lost stream truncation"
            )
            Check.That(
                Check.Text(stopped["data"]?["error"]?["code"]) == "inference_failed" && Check.Text(
                    stopped["data"]?["output_truncated"]
                ) == "true",
                "Interrupted inference lost its safe failure classification"
            )
            Check.That(
                !stoppedResult.Output.Contains("synthetic-verifier-output-marker") && !stoppedResult.Output.Contains(
                    "synthetic-verifier-error-marker"
                ),
                "Interrupted verification leaked private output"
            )
            for action in stopped["next_actions"]?.AsArray() ?? JsonArray() {
                Check.That(Check.Text(action[1]) != "amend", "Interrupted inference suggested recovery")
            }
            record["failure_reason"] = JsonValue.Create("verification_failed")
            File.WriteAllText(Path.Combine(saved, "run.json"), record.ToJsonString())
            let correction = Check.Map(
                "uuid",
                Guid.NewGuid().ToString("D"),
                "commit",
                hash,
                "state",
                "failed",
                "failure_reason",
                "verification_failed",
                "verification",
                rows,
                "error",
                "synthetic-correction-error-marker",
                "publication_error",
                "synthetic-correction-error-marker"
            )
            File.WriteAllText(Path.Combine(saved, "correction.json"), correction.ToJsonString())
            let correctedResult = TestProcess.Run(binary, []string{"status", "--run", saved, "--json"}, temp.Env)
            let corrected = Check.Envelope(correctedResult, "status", "ok")
            Check.That(
                Check.Text(corrected["data"]?["correction"]?["error"]?["code"]) == "verification_failed",
                "Correction reason missing"
            )
            Check.That(!correctedResult.Output.Contains("synthetic-correction-error-marker"), "Correction error leaked")
            Check.That(
                Check.Text(corrected["data"]?["correction"]?["verification"]?[0]?["state"]) == "interrupted" &&
                    corrected["data"]?["correction"]?["verification"]?[0]?["exit_code"] == nil,
                "Correction summary lost incomplete verification state"
            )
            for action in corrected["next_actions"]?.AsArray() ?? JsonArray() {
                Check.That(Check.Text(action[1]) != "recover", "Suggested removed recovery command")
            }
            File.Copy(binary, Path.Combine(temp.Root, "tokate-cli"))
            let pty = TestProcess.Run(
                "/usr/bin/script",
                []string{
                    "-q",
                    "-e",
                    "-c",
                    "test -t 1 && ./tokate-cli status --run ./saved --json 2>diagnostics",
                    "/dev/null"
                },
                temp.Env,
                cwd: temp.Root
            )
            Check.Envelope(pty, "status", "ok")
            record["commit"] = JsonValue.Create(String('a', 70000))
            File.WriteAllText(Path.Combine(saved, "run.json"), record.ToJsonString())
            Check.Envelope(
                TestProcess.Run(binary, []string{"status", "--run", saved, "--json"}, temp.Env),
                "status",
                "error",
                "output_too_large"
            )
            let longError = Check.Envelope(
                TestProcess.Run(binary, []string{"doctor", "--" + String('x', 6000), "--json"}, temp.Env),
                "doctor",
                "error",
                "invalid_arguments"
            )
            Check.That(
                Check.Text(longError["error"]?["message"]).Length <= 2048 && Check.Text(
                    longError["truncated"]
                ) == "true",
                "Unbounded display prose"
            )
            Console.WriteLine(
                "PASS structured CLI: metadata, errors before effects, diagnostics, scripts, redirected/PTY output, bounded summaries and private markers"
            )
        }

        internal func Saved(binary string) {
            using let temp = Temp()
            temp.Env["TERM"] = "dumb"
            temp.Env["NO_COLOR"] = "1"
            temp.Env["PATH"] = Path.Combine(temp.Root, "bin")
            let executable = Path.Combine(temp.Root, "tokate saved")
            File.Copy(binary, executable)
            let root = Path.Combine(temp.Env["HOME"], ".local/state/tokate/runs")
            let first = Path.Combine(root, "a first")
            let second = Path.Combine(root, "b second")
            Directory.CreateDirectory(first)
            Directory.CreateDirectory(second)
            let record = Check.Map(
                "version",
                2,
                "id",
                "first",
                "repo",
                "owner/project",
                "issue",
                1,
                "donor",
                "donor",
                "model",
                "fixture-model",
                "state",
                "claimed",
                "source",
                "tokate",
                "seconds",
                60,
                "verification_reserve",
                20
            )
            File.WriteAllText(Path.Combine(first, "run.json"), record.ToJsonString())
            record["id"] = JsonValue.Create("second")
            record["state"] = JsonValue.Create("generated")
            record["model"] = JsonValue.Create("second\u001b[31m")
            File.WriteAllText(Path.Combine(second, "run.json"), record.ToJsonString())
            File.SetLastWriteTimeUtc(Path.Combine(first, "run.json"), DateTime(2024, 2, 1))
            File.SetLastWriteTimeUtc(Path.Combine(second, "run.json"), DateTime(2024, 1, 1))
            let offline = Check.Envelope(Call(binary, []string{"runs", "--json"}, temp), "runs", "ok")
            Check.That(
                offline["data"]?["runs"]?.AsArray().Count == 2,
                "Local repository failure stopped saved-run listing"
            )
            let firstBytes = Check.Hash(Path.Combine(first, "run.json"))
            let secondBytes = Check.Hash(Path.Combine(second, "run.json"))
            let obsolete = Path.Combine(root, "obsolete")
            Directory.CreateDirectory(obsolete)
            record["version"] = JsonValue.Create(1)
            let obsoleteText = record.ToJsonString()
            File.WriteAllText(Path.Combine(obsolete, "run.json"), obsoleteText)
            record["version"] = JsonValue.Create(2)
            let broken = Path.Combine(root, "broken")
            let oversized = Path.Combine(root, "oversized")
            Directory.CreateDirectory(broken)
            Directory.CreateDirectory(oversized)
            File.WriteAllText(Path.Combine(broken, "run.json"), "{")
            File.WriteAllText(Path.Combine(oversized, "run.json"), String('x', 1024 * 1024 + 1))
            Directory.CreateSymbolicLink(Path.Combine(root, "linked"), first)
            Call(binary, []string{"runs", "--json"}, temp)
            Check.That(
                File.ReadAllText(Path.Combine(obsolete, "run.json")) == obsoleteText,
                "Unsupported saved run was changed"
            )
            Check.That(
                Check.Hash(Path.Combine(first, "run.json")) == firstBytes && Check.Hash(
                    Path.Combine(second, "run.json")
                ) == secondBytes,
                "Saved inspection changed metadata"
            )
            Check.That(
                Directory.GetFileSystemEntries(first).Length == 1 && Directory.GetFileSystemEntries(second).Length == 1,
                "Saved inspection created execution artifacts"
            )
            let named = Path.Combine(root, "owner-project-1-7")
            Directory.CreateDirectory(named)
            File.Copy(Path.Combine(second, "run.json"), Path.Combine(named, "run.json"))
            File.SetLastWriteTimeUtc(Path.Combine(named, "run.json"), DateTime(2024, 3, 1))
            let listed = Check.Envelope(Call(binary, []string{"runs", "owner/project", "--json"}, temp), "runs", "ok")
            Check.That(
                Check.Text(listed["data"]?["runs"]?[0]?["name"]) == "owner/project#1-7" && Check.Text(
                    listed["data"]?["runs"]?[1]?["run"]
                ) == first &&
                    Check.Text(listed["data"]?["runs"]?[2]?["name"]) == "owner/project#1-2",
                "Saved runs lost stable names"
            )
            let skipped = listed["data"]?["skipped_entries"]?.AsArray() ?? throw Exception("Missing skipped entries")
            Check.That(skipped.Count == 4 && Check.Text(listed["data"]?["skipped"]) == "4", "Skipped entries missing")
            for entry in skipped {
                let path = Check.Text(entry["run"])
                let reason = Check.Text(entry["reason"])
                Check.That(
                    (path == obsolete && reason == "Unsupported version or incomplete saved contribution.") ||
                        (
                        (path == broken || path == oversized) && reason == "Missing, invalid or oversized run metadata."
                    ) ||
                        (path == Path.Combine(root, "linked") && reason == "Unsafe saved run path."),
                    "Skipped entry lost its path or reason"
                )
            }
            let other = Path.Combine(root, Guid.NewGuid().ToString("D"))
            Directory.CreateDirectory(other)
            record["repo"] = JsonValue.Create("aaa/other")
            File.WriteAllText(Path.Combine(other, "run.json"), record.ToJsonString())
            File.SetLastWriteTimeUtc(Path.Combine(other, "run.json"), DateTime(2024, 4, 1))
            record["repo"] = JsonValue.Create("owner/project")
            let git = Path.Combine(temp.Root, "bin/git")
            File.WriteAllText(git, "#!/bin/sh\nprintf '%s\\n' 'origin https://github.com/OWNER/PROJECT.git (fetch)'\n")
            File.SetUnixFileMode(git, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute)
            temp.Env["PATH"] += ":/usr/bin:/bin"
            let ordered = Check.Envelope(Call(binary, []string{"runs", "--json"}, temp), "runs", "ok")
            Check.That(
                Check.Text(ordered["data"]?["runs"]?[0]?["run"]) == named && Check.Text(
                    ordered["data"]?["runs"]?[1]?["run"]
                ) == first &&
                    Check.Text(ordered["data"]?["runs"]?[2]?["run"]) == second && Check.Text(
                    ordered["data"]?["runs"]?[3]?["run"]
                ) == other,
                "Saved list did not put the local repository first and newest entries first"
            )
            File.Delete(git)
            temp.Env["PATH"] = Path.Combine(temp.Root, "bin")
            Directory.Delete(other, true)
            let exact = Check.Envelope(
                Call(binary, []string{"status", "owner/project#1-7", "--json"}, temp),
                "status",
                "ok"
            )
            Check.That(Check.Text(exact["data"]?["run"]) == named, "Run name selected another attempt")
            Check.Contains(
                Call(binary, []string{"status", "owner/project#1-9"}, temp, 1).Error,
                "No saved run owner/project#1-9"
            )
            Console.WriteLine(
                "PASS offline saved contribution names, invalid and linked metadata, ordering and private state preservation"
            )
        }

        internal func All(binary string, shell string = "bash") {
            if shell == "bash" {
                Structured(binary)
                TerminalOutput.All(binary)
                Saved(binary)
            }
            Contract(binary, shell)
        }

        internal func Contract(binary string, shell string = "bash") {
            Check.That(shell == "bash" || shell == "zsh" || shell == "fish", "Choose bash, zsh or fish")
            using let temp = Temp()
            let bin = Path.Combine(temp.Root, "bin")
            let log = Path.Combine(temp.Root, "calls")
            for name in[]string{"git", "gh", "codex", "setsid"} {
                let tool = Path.Combine(bin, name)
                File.WriteAllText(
                    tool,
                    "#!/bin/sh\nprintf '%s\\n' '" +
                        name +
                        "' \"$$@\" >> '" +
                        log +
                        "'\ntest \"$1\" = --version && exit 0\nexit 17\n"
                )
                File.SetUnixFileMode(tool, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute)
            }
            for argv in[][]string{[]string{}, []string{"--help"}, []string{"-h"}, []string{"help"}} {
                let help = Call(binary, argv, temp)
                Check.Contains(help.Output, "toh-KAH-teh")
                Check.That(help.Error == "", "Help wrote warnings")
                Check.That(
                    !help.Output.Contains("repo> ") && !help.Output.Contains("tokate> "),
                    "Redirected entry or explicit help started an interactive view"
                )
            }
            for command in Commands {
                if command == "help" {
                    continue
                }
                for argv in[][]string{[]string{command, "--help"}, []string{command, "-h"}, []string{"help", command}} {
                    let help = Call(binary, argv, temp)
                    Check.Contains(help.Output, "Usage: tokate " + command)
                    Check.Contains(help.Output, "Example:")
                    Check.That(help.Error == "", "Command help wrote warnings")
                    if help.Output.Contains("--run DIR") {
                        Check.That(
                            !help.Output.Contains("--run DIR (required)"),
                            "Run directory alternative marked required"
                        )
                        Check.Contains(help.Output, "Exact saved run directory")
                    }
                }
            }
            let work = Call(binary, []string{"work", "--help"}, temp).Output
            Check.Contains(work, "inference")
            Check.Contains(work, "verify it")
            Check.Contains(work, "Total budget for coding and verification")
            Check.Contains(work, "Bare work uses the local GitHub remote")
            Check.Contains(work, "use RUN or --run DIR instead of required inputs")
            Check.That(!work.Contains("tokate doctor"), "Work help repeats global help")
            let unnamed = Call(binary, []string{"claim", "owner/project"}, temp, 1)
            Check.Contains(unnamed.Error, "Name an issue: tokate claim OWNER/REPO#NUMBER.")
            Check.Contains(
                Call(binary, []string{"init", "owner/project", "--max-time", "2d"}, temp, 1).Error,
                "Use at most 24h: --max-time"
            )
            Check.Contains(
                Call(binary, []string{"work", "owner/project#1", "--time", "2d"}, temp, 1).Error,
                "Use at most 24h: --time"
            )

            for argv in[][]string{
                []string{"nonsense", "--help"},
                []string{"help", "nonsense"},
                []string{"help", "work", "extra"},
                []string{"work", "--unknown=value", "--help"},
                []string{"work", "--issue=1"},
                []string{"work", "1", "2", "3"},
                []string{"checks", "--pr=1"},
                []string{"access", "--operation=list"},
                []string{"work", "--help", "-h"},
                []string{"work", "--model="},
                []string{"work", "--model", "--help"},
                []string{"checks", "--watch=true"},
                []string{"work", "--unlimited=false"},
                []string{"checks", "--run=x", "1"},
                []string{"checks", "--run=x", "--repo=owner/project"},
                []string{"work", "--run=x", "--time=1s"},
                []string{"work", "--run=x", "https://github.com/owner/project/issues/1"},
                []string{"amend", "--run=x", "--time=0s"},
                []string{"checks", "--run=x", "--timeout=86401s"},
                []string{"approve", "--base-branch=bad..branch", "--help"},
                []string{"approve", "--base-branch=release//next", "--help"},
                []string{"approve", "--base-branch=release.lock", "--help"},
                []string{"approve", "--base-branch=refs/heads/.hidden", "--help"},
                []string{"approve", "--base-branch=release", "--base-branch=other", "--help"},
                []string{"work", "--base-branch=release", "--help"},
                []string{"work", "--profile=x"},
                []string{"revoke", "owner/project#0"},
                []string{"work", "owner/project#1", "--model=model", "--effort=invalid"},
                []string{"work", "owner/project#1", "--model=bad model", "--effort=high"},
                []string{"revoke", "other/project#1", "owner/project#1"},
                []string{"revoke", "2", "https://github.com/owner/project/issues/1"},
                []string{"revoke", "https://github.com/owner/project/pull/1"},
                []string{"revoke", "https://example.test/owner/project/issues/1"},
                []string{"work", "owner/project#1", "--repo=other/project"},
                []string{"work", "https://example.test/owner/project"},
                []string{"checks", "https://github.com/owner/project/pull/1", "2"},
                []string{"checks", "https://github.com/owner/project/pull/1", "--repo=other/project"},
                []string{"checks", "https://example.test/owner/project/pull/1"},
                []string{"work", "owner/project", "--run=x"},
                []string{"revoke", "https://github.com/owner/project/issues/0"},
                []string{"revoke", "https://github.com/owner/project/issues/999999999999"},
                []string{"prepare", "owner/project#1", "--state=bad", "--source=external", "--tools=tools.json"},
                []string{"prepare", "owner/project#1", "--source=invalid"},
                []string{"external", "--run=x", "--commit=HEAD"},
                []string{"request", "owner/project#1"},
                []string{"coordinator-setup", "--repo=owner/project"},
                []string{"coordinate", "--repo=owner/project"},
                []string{"submit"},
                []string{"completion"},
                []string{"completion", "powershell"},
                []string{"completion", "powershell", "--help"},
                []string{"completion", "bash", "extra"},
                []string{"status", "--run=x", "owner/project#1"}
            } {
                Check.Contains(Call(binary, argv, temp, 1).Error, "Usage:")
            }
            let saved = Path.Combine(temp.Root, "run")
            Directory.CreateDirectory(saved)
            File.WriteAllText(Path.Combine(saved, "run.json"), "{\"version\":2,\"state\":\"claimed\"}")
            Check.Contains(Call(binary, []string{"status", "--run=" + saved}, temp).Output, "claimed")
            Check.That(!File.Exists(log), "Help or invalid inputs invoked a tool")

            {
                let script = Call(binary, []string{"completion", shell}, temp).Output
                let path = Path.Combine(temp.Root, "completion." + shell)
                File.WriteAllText(path, script)
                Check.Success(TestProcess.Run("/usr/bin/" + shell, []string{"-n", path}, temp.Env))
                var command string
                var args[]string
                if shell == "bash" {
                    let spaced = Path.Combine(temp.Root, "run with spaces")
                    Directory.CreateDirectory(spaced)
                    let files = Path.Combine(temp.Root, "files with spaces")
                    Directory.CreateDirectory(files)
                    for name in[]string{"request.json", "summary with spaces.json", "output with spaces.yml"} {
                        File.WriteAllText(Path.Combine(temp.Root, name), "")
                    }
                    File.WriteAllText(Path.Combine(files, "summary with spaces.json"), "")
                    command = "source '" +
                        path +
                        "'; COMP_WORDS=(tokate work --mo); COMP_CWORD=2; _tokate; printf '%s\\n' \"$${COMPREPLY[@]}\"; " +
                        "COMP_WORDS=(tokate work --effort=hi); _tokate; printf '%s\\n' \"$${COMPREPLY[@]}\"; " +
                        "COMP_WORDS=(tokate work '--runs=" +
                        temp.Root +
                        "/run w'); _tokate; printf '%s\\n' \"$${COMPREPLY[@]}\"; " +
                        "expect_reply() { [[ $${#COMPREPLY[@]} == 1 && $${COMPREPLY[0]} == \"$$1\" ]] || exit 1; }; " +
                        "file_completion() { local cmd=$$1 option=$$2 stem=$$3 expected=$$4; " +
                        "COMP_WORDS=(tokate \"$$cmd\" \"$$option\" \"$$stem\"); COMP_CWORD=3; _tokate; expect_reply \"$$expected\"; " +
                        "COMP_WORDS=(tokate \"$$cmd\" \"$$option=$$stem\"); COMP_CWORD=2; _tokate; expect_reply \"$$option=$$expected\"; " +
                        "COMP_WORDS=(tokate \"$$cmd\" \"$$option\" = \"$$stem\"); COMP_CWORD=4; _tokate; expect_reply \"$$expected\"; }; " +
                        "file_completion request --file req request.json; " +
                        "file_completion external --summary sum 'summary with spaces.json'; " +
                        "file_completion coordinator-setup --output out 'output with spaces.yml'; " +
                        "file_completion external --summary 'files with spaces/sum' 'files with spaces/summary with spaces.json'; " +
                        "COMP_WORDS=(tokate request --file missing-candidate); COMP_CWORD=3; _tokate; [[ $${#COMPREPLY[@]} == 0 ]] || exit 1; " +
                        "COMP_WORDS=(tokate request --file =); _tokate; [[ \" $${COMPREPLY[*]} \" == *' request.json '* ]] || exit 1"
                    args = []string{"--noprofile", "--norc", "-c", command}
                } else if shell == "zsh" {
                    command = "autoload -Uz compinit; compinit -D; source '" +
                        path +
                        "'; " +
                        "_arguments() { if [[ $$1 == -C ]]; then state=args; line=(work); else print -rl -- \"$$@\"; fi; }; _tokate"
                    args = []string{"-f", "-c", command}
                } else {
                    command = "source '" +
                        path +
                        "'; complete -C 'tokate work --mo'; complete -C 'tokate work --effort=hi'; complete -C 'tokate work --claude-pro'"
                    args = []string{"--no-config", "-c", command}
                }
                let output = Check.Success(TestProcess.Run("/usr/bin/" + shell, args, temp.Env, cwd: temp.Root))
                Check.Contains(output, "--model")
                Check.Contains(output, shell == "zsh" ? "--effort=": "--effort=high")
                if shell == "fish" {
                    Check.Contains(output, "--claude-profile")
                }
                if shell == "bash" {
                    Check.Contains(output, "--runs=" + Path.Combine(temp.Root, "run with spaces"))
                }
                if shell == "zsh" {
                    File.Copy(path, Path.Combine(temp.Root, "_tokate"))
                    let autoload = "fpath=('" +
                        temp.Root +
                        "' $$fpath); autoload -Uz _tokate; " +
                        "_arguments() { if [[ $$1 == -C ]]; then state=args; line=(work); else print -rl -- \"$$@\"; fi; }; _tokate"
                    Check.Contains(
                        Check.Success(TestProcess.Run("/usr/bin/zsh", []string{"-f", "-c", autoload}, temp.Env)),
                        "--model"
                    )
                }
            }
            Check.That(!File.Exists(log), "Completion invoked a tool")
            let empty = Path.Combine(temp.Root, "empty")
            Directory.CreateDirectory(empty)
            let originalPath = temp.Env["PATH"]
            temp.Env["PATH"] = empty
            Call(binary, []string{"work", "--help"}, temp)
            Call(binary, []string{"help", "work"}, temp)
            Call(binary, []string{"-h"}, temp)
            Call(binary, []string{"completion", "bash"}, temp)
            Check.Contains(Call(binary, []string{"work"}, temp, 1).Error, "Local Git is unavailable; name OWNER/REPO")
            Check.Contains(Call(binary, []string{"policy"}, temp, 1).Error, "name OWNER/REPO")
            temp.Env["PATH"] = originalPath

            File.Delete(Path.Combine(bin, "setsid"))
            File.CreateSymbolicLink(Path.Combine(bin, "setsid"), "/usr/bin/setsid")
            let issueUrl = "https://github.com/owner/project/issues/1"
            let commentUrl = "https://github.com/owner/project/issues/1#issuecomment-2"
            for argv in[][]string{
                []string{"policy", "owner/project"},
                []string{"policy", "https://github.com/owner/project"},
                []string{"checks", "https://github.com/owner/project/pull/1"},
                []string{"work", issueUrl, "--model=model", "--effort=high"},
                []string{"work", "owner/project#1", "--model=model", "--effort=high"},
                []string{"work", commentUrl, "--model=model", "--effort=high"},
                []string{
                    "work",
                    "https://github.com/owner/project/releases/tag/v1.2.0?ref=x#fragment",
                    "--model=model",
                    "--effort=high",
                    "--yes"
                }
            } {
                let result = TestProcess.Run(binary, argv, temp.Env, cwd: temp.Root)
                Check.That(result.Code == 1, "Recording gh stub should fail")
                Check.Contains(File.ReadAllText(log), "gh\napi\n")
                Check.That(!result.Error.Contains("Usage:"), "Valid URL input rejected")
                File.Delete(log)
            }
            temp.Tool("holder")
            using let listener = Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified)
            listener.Bind(Address(temp.Root))
            listener.Listen(1)
            let observed = Chan[string](1)
            go Observe(listener, observed)
            File.WriteAllText(
                Path.Combine(bin, "git"),
                "#!/bin/sh\nprintf '%s' \"$$LANG\" > child-lang\n" +
                    "[ -z \"$${LC_ALL+x}\" ] && : > child-lc-all-unset\n" +
                    "/usr/bin/setsid ./bin/holder --discovery-holder &\ni=0\n" +
                    "while [ ! -f holder-ready ] && [ \"$$i\" -lt 500 ]; do /bin/sleep 0.01; i=$$((i + 1)); done\n" +
                    "[ -f holder-ready ]\n"
            )
            let clock = Stopwatch.StartNew()
            let discovery = Call(binary, []string{"policy"}, temp, 1)
            let pid = <-observed
            Check.That(!pid.StartsWith("error:"), pid)
            Check.That(clock.Elapsed.TotalSeconds < 8, "Repository discovery exceeded its cleanup bound")
            Check.Contains(discovery.Error, "No GitHub remote found")
            Check.That(
                File.ReadAllText(Path.Combine(temp.Root, "child-lang")) == temp.Env["LANG"],
                "Child LANG changed"
            )
            Check.That(File.Exists(Path.Combine(temp.Root, "child-lc-all-unset")), "Child LC_ALL changed")
            Collected(pid)
            Check.That(!File.Exists(log), "Failed repository discovery invoked GitHub")
            File.WriteAllText(Path.Combine(bin, "git"), "#!/bin/sh\n: > namespace-command-started\n")
            let unavailable = TestProcess.Run(
                "/usr/bin/bwrap",
                []string{
                    "--unshare-user",
                    "--unshare-pid",
                    "--disable-userns",
                    "--bind",
                    "/",
                    "/",
                    "--",
                    binary,
                    "policy",
                    "--json"
                },
                temp.Env,
                cwd: temp.Root
            )
            let blocked = Check.Envelope(unavailable, "policy", "error", "namespace_unavailable")
            Check.Contains(Check.Text(blocked["error"]?["message"]), "Namespace startup failed")
            Check.That(
                !File.Exists(Path.Combine(temp.Root, "namespace-command-started")),
                "Git ran without a namespace"
            )
            let doctor = TestProcess.Run(
                "/usr/bin/bwrap",
                []string{
                    "--unshare-user",
                    "--disable-userns",
                    "--bind",
                    "/",
                    "/",
                    "--",
                    binary,
                    "doctor",
                    "external",
                    "--json"
                },
                temp.Env,
                cwd: temp.Root
            )
            let restricted = Check.Envelope(doctor, "doctor", "error", "namespace_unavailable")
            Check.That(
                Check.Text(restricted["data"]?["tools"]?[0]?["code"]) == "namespace_unavailable",
                "Doctor mislabeled namespace failure as missing tools"
            )
            Check.That(
                restricted["next_actions"]?.AsArray().Count == 0,
                "Doctor offered installation for blocked namespaces"
            )
            File.Delete(Path.Combine(bin, "git"))
            File.CreateSymbolicLink(Path.Combine(bin, "git"), "/usr/bin/git")
            Check.Success(TestProcess.Run("/usr/bin/git", []string{"init", "-b", "main", temp.Root}, temp.Env))
            Check.Contains(Call(binary, []string{"policy"}, temp, 1).Error, "No GitHub remote")
            Check.Success(
                TestProcess.Run(
                    "/usr/bin/git",
                    []string{"-C", temp.Root, "remote", "add", "origin", "git@github.com:owner/project.git"},
                    temp.Env
                )
            )
            let policy = TestProcess.Run(binary, []string{"policy"}, temp.Env, cwd: temp.Root)
            Check.That(policy.Code == 1 && !policy.Error.Contains("Usage:"), "Unique remote rejected")
            Check.Contains(File.ReadAllText(log), "repos/owner/project\n")
            File.Delete(log)
            let nested = Path.Combine(temp.Root, "subdirectory")
            Directory.CreateDirectory(nested)
            let fromSubdirectory = TestProcess.Run(binary, []string{"policy"}, temp.Env, cwd: nested)
            Check.That(
                fromSubdirectory.Code == 1 && !fromSubdirectory.Error.Contains("Usage:"),
                "Repository subdirectory rejected"
            )
            Check.Contains(File.ReadAllText(log), "repos/owner/project\n")
            File.Delete(log)
            Check.Success(
                TestProcess.Run(
                    "/usr/bin/git",
                    []string{"-C", temp.Root, "remote", "add", "upstream", "https://github.com/OWNER/project.git"},
                    temp.Env
                )
            )
            let same = TestProcess.Run(binary, []string{"policy"}, temp.Env, cwd: temp.Root)
            Check.That(same.Code == 1 && !same.Error.Contains("Usage:"), "Equivalent remotes rejected")
            File.Delete(log)
            Check.Success(
                TestProcess.Run(
                    "/usr/bin/git",
                    []string{"-C", temp.Root, "remote", "set-url", "upstream", "https://github.com/other/project.git"},
                    temp.Env
                )
            )
            Check.Contains(Call(binary, []string{"policy"}, temp, 1).Error, "Ambiguous local remotes")
            Check.That(!File.Exists(log), "Ambiguous remotes invoked GitHub")
            let urlOverride = TestProcess.Run(
                binary,
                []string{"work", issueUrl, "--model=model", "--effort=high", "--yes"},
                temp.Env,
                cwd: temp.Root
            )
            Check.That(
                urlOverride.Code == 1 && !urlOverride.Error.Contains("Usage:"),
                "Issue URL did not override local context"
            )
            File.Delete(log)
            Check.Success(
                TestProcess.Run("/usr/bin/git", []string{"-C", temp.Root, "remote", "remove", "upstream"}, temp.Env)
            )
            Check.Success(
                TestProcess.Run(
                    "/usr/bin/git",
                    []string{
                        "-C",
                        temp.Root,
                        "remote",
                        "set-url",
                        "--push",
                        "origin",
                        "https://github.com/other/project.git"
                    },
                    temp.Env
                )
            )
            Check.Contains(Call(binary, []string{"policy"}, temp, 1).Error, "Ambiguous local remotes")
            Check.That(!File.Exists(log), "Conflicting push remote invoked GitHub")
            let explicitRepo = TestProcess.Run(
                binary,
                []string{"policy", "https://github.com/owner/project.git"},
                temp.Env,
                cwd: temp.Root
            )
            Check.That(
                explicitRepo.Code == 1 && !explicitRepo.Error.Contains("Usage:"),
                "Explicit repo did not override local context"
            )
            Check.Contains(File.ReadAllText(log), "repos/owner/project\n")
            Check.That(!File.ReadAllText(log).Contains("codex"), "Unexpected inference")
            Check.That(!File.ReadAllText(log).Contains("POST"), "Unexpected remote mutation")
            Console.WriteLine(
                "PASS CLI discovery: help, validation, equals syntax, URL/context, completion and missing tools"
            )
        }
    }
}
