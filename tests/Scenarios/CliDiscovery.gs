package TokateTests

import Gsharp.Concurrency
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Linq
import System.Net.Sockets
import System.Runtime.InteropServices
import System.Text
import System.Text.Json.Nodes

@DllImport("libc", EntryPoint: "getsockopt", SetLastError: true)
func DiscoveryPeer(socket int32, level int32, option int32, value[]byte, length[]uint32) int32;

internal class CliDiscovery {
    shared {
        private func Commands(binary string, temp Temp) JsonArray -> Check
            .Envelope(Call(binary, []string{"help", "--json"}, temp), "help", "ok")["data"]?["commands"]
            ?.AsArray() ?? JsonArray()

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

        private func Plus(args[]string, extra ...string)[]string {
            let all = List[string](args)
            all.AddRange(extra)
            return all.ToArray()
        }

        private func Unchanged(flow NativeFixture, message string) {
            flow.Reload()
            for call in flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                Check.That(Check.Text(call["method"]) == "GET", message)
            }
            Check.That(flow.State["pulls"] == nil, message)
        }

        private func Proposed(flow NativeFixture, path string) string -> flow.Git(
            "-C",
            flow.Upstream,
            "show",
            "tokate-setup:" + path
        )

        private func Merge(flow NativeFixture) {
            flow.Git("-C", flow.Upstream, "merge", "-q", "--ff-only", "tokate-setup")
            flow.Reload()
            flow.State["pulls"] = nil
            flow.State["api_calls"] = JsonArray()
            flow.Save()
        }

        internal func Setup(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize(access: false)
            flow.ReleaseReady(hosted: false)
            Publish(flow, nil)
            let shared = "obselate/tokate/.github/workflows/tokate-shared.yml@"
            let pin = shared + "v0"
            let args = []string{
                "init",
                "owner/project",
                "--verification",
                "[[\"bash\",\"scripts/verify.sh\"]]",
                "--required-checks",
                "[\"verify\"]",
                "--plain"
            }
            let fresh = Check
                .Envelope(flow.Call([]string{"init", "owner/project", "--json"}, owner: true), "init", "ok")["data"]?[
                "changes"
            ]
                ?.AsArray() ?? throw Exception("Missing setup preview")
            var fileCount int32
            for change in fresh {
                let name = Check.Text(change["change"])
                if name.StartsWith(".github/") {
                    fileCount++
                }
                Check.That(
                    !name.Contains("protection") && !name.Contains("access") && !name.Contains("event policy") &&
                        !name.Contains("Required checks"),
                    "Unneeded setup mutation"
                )
            }
            Check.That(fileCount == 2, "Fresh setup must list exactly two files")
            Check.That(
                !fresh.ToJsonString().Contains("required_checks") && !fresh.ToJsonString().Contains("verification") &&
                    !fresh
                    .ToJsonString().Contains("maintainer_edits"),
                "Omitted optional policy fields were generated"
            )
            Unchanged(flow, "Preview changed GitHub")
            Check.Contains(flow.Call(Plus(args, "--pin", "--yes"), 1, true).Error, "Bootstrap required")
            Unchanged(flow, "Failed setup changed GitHub")
            flow.Reload()
            flow.State["repo_permissions"] = Check.Map("push", true)
            flow.Save()
            Check.Contains(flow.Call(Plus(args, "--yes"), 1, true).Error, "admin permission is required")
            Unchanged(flow, "Setup without admin changed GitHub")
            flow.Reload()
            flow.State["repo_permissions"] = nil
            flow.Save()
            let selected = Check.Map(
                "github_owned_allowed",
                true,
                "verified_allowed",
                false,
                "patterns_allowed",
                JsonArray(JsonValue.Create("actions/checkout@*"), JsonValue.Create(shared + String('c', 40)))
            )
            flow.Reload()
            flow.State["hosted_workflow"] = JsonValue.Create(true)
            flow.State["actions_permissions"] = Check.Map("enabled", false)
            flow.Save()
            Check.Contains(flow.Call(Plus(args, "--yes"), 1, true).Error, "Actions is disabled")
            Unchanged(flow, "Disabled Actions setup changed GitHub")
            flow.Reload()
            flow.State["actions_permissions"] = Check.Map("enabled", true, "allowed_actions", "selected")
            flow.State["selected_actions"] = selected.DeepClone()
            flow.State["allowlist_setup"] = JsonValue.Create(true)
            flow.State["actions_policies"] = Check.Map("total_count", 0, "policies", JsonArray())
            flow.State["workflow_permissions"] = Check.Map(
                "default_workflow_permissions",
                "read",
                "can_approve_pull_request_reviews",
                false
            )
            flow.Save()
            for flag in[]string{"--non-interactive", "--json", "redirected"} {
                flow.ResetTraffic()
                let preview = flow.Call(flag == "redirected" ? args: Plus(args, flag), owner: true)
                for change in[]string{
                    "Actions allowed workflows",
                    pin,
                    "Allow GitHub Actions to create and approve pull requests",
                    ".github/tokate.json",
                    ".github/workflows/tokate-coordinator.yml",
                    "Branch tokate-setup",
                    "Setup PR",
                    "Do not delete them",
                    "--yes"
                } {
                    Check.Contains(preview.Error, change)
                }
                if flag == "--json" {
                    let data = Check.Envelope(preview, "init", "ok")["data"]
                    Check.That(
                        Check.Text(data?["applied"]) == "false" && data?["changes"]?.AsArray().Count == 6,
                        "Preview data did not list every change"
                    )
                }
                Unchanged(flow, "Preview changed GitHub")
            }
            flow.Call([]string{"--version"}, owner: true)
            let token = flow.Temp.Env["GH_TOKEN"]
            flow.Temp.Env["GH_TOKEN"] = "fixture-owner"
            flow.ResetTraffic()
            let declined = TestTerminal.Pty(binary, args, flow.Temp, 80, "\n")
            Check.That(declined.Code == 1, declined.Output + declined.Error)
            Check.Contains(declined.Output, "Apply this setup? [y/N]")
            Unchanged(flow, "Declined setup changed GitHub")
            let accepted = TestTerminal.Pty(binary, args, flow.Temp, 80, "y\n")
            flow.Temp.Env["GH_TOKEN"] = token
            Check.Success(accepted)
            Check.That(accepted.Output.Split("Apply this setup? [y/N]").Length == 2, "Setup did not ask once")
            Check.Contains(accepted.Output, "Setup PR https://github.com/owner/project/pull/10.")
            flow.Reload()
            selected["patterns_allowed"]?.AsArray().Add(JsonValue.Create(pin) as JsonNode)
            Check.That(
                flow.State["selected_actions"]?.ToJsonString() == selected.ToJsonString(),
                "Setup did not add the pin and preserve the allowlist"
            )
            Check.That(flow.State["branch_protection"] == nil, "Setup wrote branch protection")
            Check.That(flow.State["actions_policy"] == nil, "Setup created an unneeded event policy")
            Check.That(
                flow.State["workflow_permissions"]?.ToJsonString() ==
                "{\"default_workflow_permissions\":\"read\",\"can_approve_pull_request_reviews\":true}",
                "Setup did not enable PR creation while preserving workflow permissions"
            )
            Check.That(
                Check.Text(flow.State["pulls"]?[0]?["head"]?["ref"]) == "tokate-setup" && Check.Text(
                    flow.State["pulls"]?[0]?["base"]?["ref"]
                ) == "main",
                "Setup PR has the wrong branches"
            )
            Check.That(
                flow.Git("-C", flow.Upstream, "branch", "--list", "tokate/access") == "",
                "Setup created an access ref"
            )
            Check.That(
                !File.Exists(Path.Combine(flow.Upstream, ".github/tokate.json")),
                "Setup changed the default branch"
            )
            var policy = Check.Json(Proposed(flow, ".github/tokate.json"))
            Check.That(
                Check.Text(policy["version"]) == "3" && Check.Text(policy["eligibility"]) == "trusted" && Check.Text(
                    policy["approval_scope"]
                ) == "task" &&
                    policy["allowed_tools"]?.ToJsonString() ==
                "[{\"harness\":\"codex\",\"provider\":\"openai\"},{\"harness\":\"claude\",\"provider\":\"anthropic\"},{\"harness\":\"pi\",\"provider\":\"local-chat-completions\"}]",
                "New setup did not use trusted access and any supported model"
            )
            let yaml = Proposed(flow, ".github/workflows/tokate-coordinator.yml")
            Check.Contains(yaml, "uses: " + pin)
            Check.That(
                !yaml.Contains("run:") && !yaml.Contains("checkout") && yaml.Split('\n').Length < 25,
                "Setup copied runtime code"
            )
            let branch = flow.Git("-C", flow.Upstream, "rev-parse", "tokate-setup")
            flow.ResetTraffic()
            Check.Contains(
                flow.Call(Plus(args, "--yes"), owner: true).Output,
                "Nothing to change. Review and merge the setup PR https://github.com/owner/project/pull/10"
            )
            flow.Reload()
            for call in flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                Check.That(Check.Text(call["method"]) == "GET", "Repeated setup with an open PR changed GitHub")
            }
            flow.State["pulls"] = nil
            flow.State["api_calls"] = JsonArray()
            flow.Save()
            flow.Call(Plus(args, "--yes"), owner: true)
            flow.Reload()
            var mutations int32
            for call in flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                if Check.Text(call["method"]) != "GET" {
                    mutations++
                    Check.That(
                        Check.Text(call["path"]) == "repos/owner/project/pulls",
                        "Lost PR recovery rewrote the branch"
                    )
                }
            }
            Check.That(
                mutations == 1 && flow.State["pulls"]?.AsArray().Count == 1 && flow.Git(
                    "-C",
                    flow.Upstream,
                    "rev-parse",
                    "tokate-setup"
                ) == branch,
                "Setup did not reopen the PR for an existing branch"
            )
            Merge(flow)
            Check.Contains(flow.Call(Plus(args, "--yes"), owner: true).Output, "Nothing to change")
            Unchanged(flow, "Repeated setup changed GitHub")
            flow.OwnerAccess()
            flow.Approve()
            flow.Reload()
            let second = flow.State["issue"]?.DeepClone() ?? throw Exception("Missing issue")
            second["number"] = JsonValue.Create(2)
            second["title"] = JsonValue.Create("Second task")
            flow.State["issues"] = Check.Map("1", flow.State["issue"]?.DeepClone(), "2", second)
            flow.Save()
            flow.Call([]string{"approve", "owner/project#2"}, owner: true)
            let descriptive = Check.Envelope(
                flow.Call(
                    []string{
                        "init",
                        "owner/project",
                        "--eligibility",
                        "open",
                        "--pr-text",
                        "Owner notes",
                        "--yes",
                        "--json"
                    },
                    owner: true
                ),
                "init",
                "ok"
            )
            Check.That(
                Check.Text(descriptive["data"]?["task_fields_changed"]) == "false" &&
                    descriptive["data"]?["approvals_to_renew"]
                    ?.AsArray().Count == 0,
                "Nontask init asked for new approvals"
            )
            Merge(flow)
            let status = Check.Envelope(flow.Call([]string{"status", "owner/project#1", "--json"}), "status", "ok")
            Check.That(
                Check.Text(status["data"]?["work"]?[0]?["approval_status"]) == "current",
                "Nontask init revoked approval"
            )
            let task = flow.Call(
                []string{
                    "init",
                    "owner/project",
                    "--max-time",
                    "30m",
                    "--reservation-time",
                    "1h",
                    "--base-branch",
                    "release",
                    "--close-message",
                    "Request access.",
                    "--allowed-tools",
                    "claude/anthropic,aider/openrouter",
                    "--yes"
                },
                owner: true
            )
            Check.Contains(task.Error, "tokate approve owner/project#1")
            Check.Contains(task.Error, "tokate approve owner/project#2")
            policy = Check.Json(Proposed(flow, ".github/tokate.json"))
            Check.That(
                Check.Text(policy["max_seconds"]) == "1800" && Check.Text(policy["reservation_seconds"]) == "3600" &&
                    Check.Text(policy["target_branch"]) == "release" && Check.Text(
                    policy["close_message"]
                ) == "Request access." &&
                    Check.Text(policy["pr_text"]) == "Owner notes" && Check.Text(policy["eligibility"]) == "open" &&
                    policy["allowed_tools"]?.ToJsonString() ==
                "[{\"harness\":\"claude\",\"provider\":\"anthropic\"},{\"harness\":\"aider\",\"provider\":\"openrouter\"}]",
                "Init changed explicit policy options"
            )
            Merge(flow)
            let routes = "[{\"harness\":\"claude\",\"provider\":\"anthropic\",\"models\":{\"claude-opus-5-5\":[\"high\"]}}]"
            flow.Call([]string{"init", "owner/project", "--allowed-tools", routes, "--yes"}, owner: true)
            Check.That(
                Check.Json(Proposed(flow, ".github/tokate.json"))["allowed_tools"]?.ToJsonString() == routes,
                "Init lost per-tool model maps"
            )
            Merge(flow)
            let original = File.ReadAllText(Path.Combine(flow.Upstream, ".github/tokate.json"))
            let obsolete = Check.Json(original)
            obsolete["version"] = JsonValue.Create(1)
            Publish(flow, obsolete.ToJsonString())
            flow.Call([]string{"init", "owner/project", "--yes"}, 1, true)
            Unchanged(flow, "Unsupported GitHub policy was rewritten")
            let legacy = Check.Json(original)
            legacy["version"] = JsonValue.Create(2)
            Publish(flow, legacy.ToJsonString())
            flow.Call([]string{"init", "owner/project", "--yes"}, 1, true)
            Unchanged(flow, "Version 2 policy was migrated")
            Publish(flow, original)
            let workflow = Path.Combine(flow.Upstream, ".github/workflows/tokate-coordinator.yml")
            File.WriteAllText(workflow, yaml.Replace("@v0", "@" + String('c', 40)) + "\n# synthetic-preview-\x1b[31m\n")
            flow.Commit("Install old coordinator pin")
            let update = flow.Call([]string{"init", "owner/project", "--pin", "--yes", "--plain"}, owner: true)
            Check.That(!update.Error.Contains('\x1b'), "Owner preview emitted terminal control bytes")
            Check.Contains(
                update.Error,
                "Compare shared workflows: https://github.com/obselate/tokate/compare/" +
                    String('c', 40) +
                    "..." +
                    String('a', 40)
            )
            Check.That(
                Proposed(flow, ".github/workflows/tokate-coordinator.yml") == yaml.Replace(
                    "@v0",
                    "@" + String('a', 40)
                ),
                "Init did not update the pin"
            )
            Merge(flow)
            flow.Call([]string{"init", "owner/project", "--yes"}, owner: true)
            Merge(flow)
            for mode in[]string{"excluded", "local_only"} {
                flow.Reload()
                flow.State["actions_permissions"] = Check.Map(
                    "enabled",
                    true,
                    "allowed_actions",
                    mode == "excluded" ? "selected": mode
                )
                flow.State["selected_actions"] = Check.Map(
                    "patterns_allowed",
                    JsonArray(JsonValue.Create("*"), JsonValue.Create("!" + shared + "*"))
                )
                flow.Save()
                let manual = flow.Call([]string{"init", "owner/project", "--yes", "--json"}, owner: true)
                Check.Contains(
                    manual.Error,
                    "Manual: In owner/project > Settings > Actions > General > Actions permissions, allow " + pin
                )
                Check.That(
                    Check
                        .Envelope(manual, "init", "ok")["data"]?["manual"]
                        ?.AsArray()
                        .Count == 1 &&
                        !manual
                        .Error
                        .Contains("already matches"),
                    "Manual allowlist step was hidden"
                )
                Unchanged(flow, "Blocked allowlist was changed")
            }
            flow.NoInference()
            Console.WriteLine(
                "PASS CLI owner setup: minimal defaults, exact preview, one question, required settings, setup PR, repeat, approvals, options and optional pin"
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
            let metadata = Check.Envelope(Call(binary, []string{"help", "--json"}, temp), "help", "ok")
            let expected = "work claim submit status checks pause resume renew release init approve revoke access doctor defaults update uninstall overlaps amend external completion help --version request admit coordinate"
            Check.That(
                String.Join(
                    " ",
                    (metadata["data"]?["commands"]?.AsArray() ?? JsonArray()).Select(
                        command -> Check.Text(command["command"])
                    )
                ) == expected,
                "Metadata commands differ"
            )
            for command in metadata["data"]?["commands"]?.AsArray() ?? JsonArray() {
                let name = Check.Text(command["command"])
                let help = Check.Envelope(Call(binary, []string{name, "--help", "--json"}, temp), name, "ok")
                Check.That(
                    name == "help" || Check.Text(help["data"]?["commands"]?[0]?["command"]) == name,
                    "Focused metadata missing command"
                )
                let example = TestProcess.Run(
                    "/bin/sh",
                    []string{"-c", "\"$$0\" " + Check.Text(command["example"]).Substring(7) + " --help --json", binary},
                    temp.Env,
                    cwd: temp.Root
                )
                Check.Envelope(example, name, "ok")
                let names = HashSet[string](StringComparer.Ordinal)
                for option in command["arguments"]?.AsArray() ?? JsonArray() {
                    Check.That(names.Add(Check.Text(option["name"])), "CLI metadata repeated an option")
                }
                Check.That(Check.Text(command["noninteractive"]) == "true", "Hidden interactive command")
                Check.That(
                    Check.Text(command["inference"]) == (name == "work" ? "true": "false"),
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
                []string{"approve", "0", "--json"},
                []string{"approve", "owner/project", "--json"},
                []string{"approve", "owner/project#1", "--title", "Removed", "--json"},
                []string{"access", "grant", "donor", "owner/project#1", "--json"},
                []string{"access", "remove", "donor", "owner/project#1", "--json"},
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
            for subject in[]string{"defaults", "access"} {
                let command = Check.Envelope(Call(binary, []string{"help", subject, "--json"}, temp), "help", "ok")[
                    "data"
                ]?["commands"]?[0]
                for operation in command?["operations"]?.AsArray() ?? JsonArray() {
                    let read = "show list history check".Split(' ').Contains(Check.Text(operation["name"]))
                    let writes = Check.Text(operation["effects"]?["local_write"]) == "true" || Check.Text(
                        operation["effects"]?["github_write"]
                    ) == "true"
                    Check.That(read != writes, subject + " operation effects differ: " + Check.Text(operation["name"]))
                }
            }
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
            Check.That(diagnosis["data"]?["tools"]?.AsArray().Count == 10, "Doctor omitted common checks")
            Check.That(!doctor.Output.Contains("Tokate environment"), "Doctor emitted prose stdout")
            let blocked = Check.Envelope(
                TestProcess.Run(binary, []string{"access", "list", "owner/project", "--json"}, temp.Env),
                "access",
                "error",
                "missing_tools"
            )
            Check.That(Check.Text(blocked["next_actions"]?[0]?[1]) == "doctor", "Missing-tools action absent")
            Check.Envelope(
                TestProcess.Run(binary, []string{"init", "owner/project", "--json"}, temp.Env),
                "init",
                "error",
                "missing_tools"
            )
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
            Check.Contains(legacy.Output, "State  " + Check.Text(status["data"]?["state"]))
            Check.That(!legacy.Output.TrimStart().StartsWith("{"), "Status without --json printed JSON")
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
            correction["version"] = JsonValue.Create(1)
            correction["id"] = correction["uuid"]?.DeepClone()
            record["amendment"] = JsonValue.Create(hash)
            File.WriteAllText(Path.Combine(saved, "run.json"), record.ToJsonString())
            Directory.CreateDirectory(Path.Combine(saved, "amendments", hash))
            File.WriteAllText(Path.Combine(saved, "amendments", hash, "run.json"), correction.ToJsonString())
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
            let legacyCorrection = Path.Combine(saved, "correction.json")
            let legacyArtifacts = Path.Combine(saved, "correction-" + Check.Text(correction["uuid"]))
            Directory.Move(Path.Combine(saved, "amendments", hash), legacyArtifacts)
            File.Move(Path.Combine(legacyArtifacts, "run.json"), Path.Combine(legacyArtifacts, "record.json"))
            File.WriteAllText(Path.Combine(legacyArtifacts, "candidate.patch"), "legacy-patch")
            let earlier = correction.DeepClone()
            let earlierCommit = String('b', 40)
            let earlierId = Guid.NewGuid().ToString("D")
            earlier["commit"] = JsonValue.Create(earlierCommit)
            earlier["uuid"] = JsonValue.Create(earlierId)
            earlier["id"] = JsonValue.Create(earlierId)
            let earlierArtifacts = Path.Combine(saved, "correction-" + earlierId)
            Directory.CreateDirectory(earlierArtifacts)
            File.WriteAllText(Path.Combine(earlierArtifacts, "record.json"), earlier.ToJsonString())
            File.WriteAllText(Path.Combine(earlierArtifacts, "candidate.patch"), "earlier-patch")
            record.AsObject().Remove("amendment")
            File.WriteAllText(Path.Combine(saved, "run.json"), record.ToJsonString())
            File.WriteAllText(legacyCorrection, correction.ToJsonString())
            using let migrationLease = File.Open(
                Path.Combine(saved, ".lock"),
                FileMode.OpenOrCreate,
                FileAccess.ReadWrite,
                FileShare.None
            )
            Check.Envelope(
                TestProcess.Run(binary, []string{"status", "--run", saved, "--json"}, temp.Env),
                "status",
                "ok"
            )
            Check.That(
                File.Exists(legacyCorrection) && Directory.Exists(legacyArtifacts),
                "Status migrated a correction without the run lease"
            )
            migrationLease.Dispose()
            let migrated = TestProcess.Run(binary, []string{"status", "--run", saved, "--json"}, temp.Env)
            Check.Envelope(migrated, "status", "ok")
            Check.That(
                !File.Exists(legacyCorrection) && !Directory.Exists(legacyArtifacts),
                "Legacy correction was not migrated"
            )
            let migratedPath = Path.Combine(saved, "amendments", hash, "run.json")
            Check.That(
                JsonNode.DeepEquals(Check.Json(File.ReadAllText(migratedPath)), correction),
                "Migration changed correction data"
            )
            Check.That(
                Check.Text(Check.Json(File.ReadAllText(Path.Combine(saved, "run.json")))["amendment"]) == hash,
                "Migration did not select the amendment"
            )
            Check.That(
                File.ReadAllText(Path.Combine(saved, "amendments", hash, "candidate.patch")) == "legacy-patch",
                "Migration lost correction artifacts"
            )
            Check.That(
                !Directory.Exists(earlierArtifacts) && JsonNode.DeepEquals(
                    Check.Json(File.ReadAllText(Path.Combine(saved, "amendments", earlierCommit, "run.json"))),
                    earlier
                ) &&
                    File.ReadAllText(Path.Combine(saved, "amendments", earlierCommit, "candidate.patch")) ==
                "earlier-patch" && Directory.GetDirectories(Path.Combine(saved, "amendments")).Length == 2,
                "Migration lost an earlier correction attempt"
            )
            let migratedRecord = File.ReadAllText(migratedPath)
            Check.Envelope(
                TestProcess.Run(binary, []string{"status", "--run", saved, "--json"}, temp.Env),
                "status",
                "ok"
            )
            Check.That(File.ReadAllText(migratedPath) == migratedRecord, "Migration repeated")
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
            let offline = Check.Envelope(Call(binary, []string{"status", "--json"}, temp), "status", "ok")
            Check.That(
                offline["data"]?["runs"]?.AsArray().Count == 2,
                "Local repository failure stopped saved-run listing"
            )
            let legacyRun = Path.Combine(root, "legacy-correction")
            Directory.CreateDirectory(legacyRun)
            File.WriteAllText(Path.Combine(legacyRun, "run.json"), record.ToJsonString())
            File.WriteAllText(Path.Combine(legacyRun, "correction.json"), "{}")
            let isolated = Check.Envelope(Call(binary, []string{"status", "--json"}, temp), "status", "ok")
            Check.That(
                isolated["data"]?["runs"]?.AsArray().Count == 2 && Check.Text(isolated["data"]?["skipped"]) == "1",
                "Invalid correction stopped other saved runs"
            )
            Check.Contains(Check.Text(isolated["data"]?["skipped_entries"]?[0]?["reason"]), "tokate status --run")
            Check.That(
                File.ReadAllText(Path.Combine(legacyRun, "correction.json")) == "{}",
                "Invalid correction was changed"
            )
            Directory.Delete(legacyRun, true)
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
            Call(binary, []string{"status", "--json"}, temp)
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
            let listed = Check.Envelope(Call(binary, []string{"status", "--json"}, temp), "status", "ok")
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
            let failed = Path.Combine(root, "failed")
            Directory.CreateDirectory(failed)
            record["state"] = JsonValue.Create("failed")
            File.WriteAllText(Path.Combine(failed, "run.json"), record.ToJsonString())
            let ordered = Check.Envelope(Call(binary, []string{"status", "--json"}, temp), "status", "ok")
            Check.That(
                ordered["data"]?["runs"]?.AsArray().Count == 3 && Check.Text(
                    ordered["data"]?["runs"]?[0]?["run"]
                ) == named &&
                    Check.Text(ordered["data"]?["runs"]?[1]?["run"]) == first && Check.Text(
                    ordered["data"]?["runs"]?[2]?["run"]
                ) == second &&
                    Check.Text(ordered["data"]?["hidden"]) == "1",
                "Checkout status did not list only local unfinished runs, newest first"
            )
            let all = Check.Envelope(Call(binary, []string{"status", "--all", "--json"}, temp), "status", "ok")
            Check.That(
                all["data"]?["runs"]?.AsArray().Count == 4 && Check.Text(all["data"]?["hidden"]) == "0",
                "Status --all hid finished runs"
            )
            Directory.Delete(failed, true)
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

        private func Completes(path string, commands JsonArray, temp Temp) {
            var probe = "source '" +
                path +
                "'; COMP_WORDS=(tokate ''); COMP_CWORD=1; _tokate; printf '%s\\n' \"$${COMPREPLY[@]}\"; "
            for command in commands {
                let name = Check.Text(command["command"])
                probe += "COMP_WORDS=(tokate '" +
                    name +
                    "' ''); COMP_CWORD=2; _tokate; printf '" +
                    name +
                    " %s\\n' \"$${COMPREPLY[@]}\"; "
            }
            let listed = HashSet[string](
                Check.Success(
                    TestProcess.Run("/usr/bin/bash", []string{"--noprofile", "--norc", "-c", probe}, temp.Env)
                )
                    .Split('\n')
            )
            Check.That(!listed.Contains("doctor command"), "Completion offers the command harness to doctor")
            for command in commands {
                let name = Check.Text(command["command"])
                Check.That(listed.Contains(name) && listed.Contains("help " + name), "Completion omits command " + name)
                let words = List[string]()
                for option in command["arguments"]?.AsArray() ?? JsonArray() {
                    words.Add(Check.Text(option["name"]))
                    if Check.Text(option["name"]) == "--harness" && command["positional_arguments"]?.ToJsonString()
                        .Contains("HARNESS") == true {
                        words.AddRange(
                            option["choices"]
                                ?.AsArray()
                                .Select(choice -> Check.Text(choice))
                                .Where(choice -> choice != "command") ??
                                []string{}
                        )
                    }
                }
                for position in command["positional_arguments"]?.AsArray() ?? JsonArray() {
                    words.AddRange(Check.Text(position).Split('|').Where(word -> Char.IsLower(word[0])))
                }
                for word in name == "help" ? List[string](): words {
                    Check.That(listed.Contains(name + " " + word), "Completion omits " + name + " " + word)
                }
            }
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
            let commands = Commands(binary, temp)
            for command in commands {
                let name = Check.Text(command["command"])
                if name == "help" {
                    continue
                }
                for argv in[][]string{[]string{name, "--help"}, []string{name, "-h"}, []string{"help", name}} {
                    let help = Call(binary, argv, temp)
                    Check.Contains(help.Output, "Usage: tokate " + name)
                    Check.Contains(help.Output, "Example:")
                    Check.That(help.Error == "", "Command help wrote warnings")
                    Check.That(
                        !help.Output.Contains("--run DIR (required)"),
                        "Run directory alternative marked required"
                    )
                }
            }
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
                []string{"claim", "owner/project#1", "--source=invalid"},
                []string{"external", "--run=x", "--commit=HEAD"},
                []string{"request", "owner/project#1"},
                []string{"coordinate", "--repo=owner/project"},
                []string{"submit"},
                []string{"completion"},
                []string{"completion", "powershell"},
                []string{"completion", "powershell", "--help"},
                []string{"completion", "bash", "extra"},
                []string{"status", "--run=x", "owner/project#1"},
                []string{"verify-pr"},
                []string{"access", "unknown"},
                []string{"defaults", "list", "NAME"},
                []string{"doctor", "repo", "managed"},
                []string{"work", "owner/project", "NAME"},
                []string{"work", "stop"}
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
                    for name in[]string{"request.json", "summary with spaces.json"} {
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
                    Completes(path, commands, temp)
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
            Check.Contains(Call(binary, []string{"doctor", "repo"}, temp, 1).Error, "name OWNER/REPO")
            temp.Env["PATH"] = originalPath

            File.Delete(Path.Combine(bin, "setsid"))
            File.CreateSymbolicLink(Path.Combine(bin, "setsid"), "/usr/bin/setsid")
            let issueUrl = "https://github.com/owner/project/issues/1"
            let commentUrl = "https://github.com/owner/project/issues/1#issuecomment-2"
            for argv in[][]string{
                []string{"doctor", "repo", "owner/project"},
                []string{"doctor", "repo", "https://github.com/owner/project"},
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
            let discovery = Call(binary, []string{"doctor", "repo"}, temp, 1)
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
                    "doctor",
                    "repo",
                    "--json"
                },
                temp.Env,
                cwd: temp.Root
            )
            let blocked = Check.Envelope(unavailable, "doctor", "error", "namespace_unavailable")
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
            Check.Contains(Call(binary, []string{"doctor", "repo"}, temp, 1).Error, "No GitHub remote")
            Check.Success(
                TestProcess.Run(
                    "/usr/bin/git",
                    []string{"-C", temp.Root, "remote", "add", "origin", "git@github.com:owner/project.git"},
                    temp.Env
                )
            )
            let policy = TestProcess.Run(binary, []string{"doctor", "repo"}, temp.Env, cwd: temp.Root)
            Check.That(policy.Code == 1 && !policy.Error.Contains("Usage:"), "Unique remote rejected")
            Check.Contains(File.ReadAllText(log), "repos/owner/project\n")
            File.Delete(log)
            let nested = Path.Combine(temp.Root, "subdirectory")
            Directory.CreateDirectory(nested)
            let fromSubdirectory = TestProcess.Run(binary, []string{"doctor", "repo"}, temp.Env, cwd: nested)
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
            let same = TestProcess.Run(binary, []string{"doctor", "repo"}, temp.Env, cwd: temp.Root)
            Check.That(same.Code == 1 && !same.Error.Contains("Usage:"), "Equivalent remotes rejected")
            File.Delete(log)
            Check.Success(
                TestProcess.Run(
                    "/usr/bin/git",
                    []string{"-C", temp.Root, "remote", "set-url", "upstream", "https://github.com/other/project.git"},
                    temp.Env
                )
            )
            Check.Contains(Call(binary, []string{"doctor", "repo"}, temp, 1).Error, "Ambiguous local remotes")
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
            Check.Contains(Call(binary, []string{"doctor", "repo"}, temp, 1).Error, "Ambiguous local remotes")
            Check.That(!File.Exists(log), "Conflicting push remote invoked GitHub")
            let explicitRepo = TestProcess.Run(
                binary,
                []string{"doctor", "repo", "https://github.com/owner/project.git"},
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
