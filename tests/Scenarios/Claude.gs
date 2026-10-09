package TokateTests

import System
import System.Collections.Generic
import System.IO
import System.Text.Json.Nodes

internal class ClaudeChecks {
    shared {
        private func Managed(binary string) {
            for mode in[]string{"normal", "incomplete", "conflict", "failed"} {
                using let test = CoordinationFixture(binary)
                test.Initialize(approve: false)
                let flow = test.Flow
                flow.Temp.Tool("claude")
                let policyPath = Path.Combine(flow.Upstream, ".github/tokate.json")
                let policy = Check.Json(File.ReadAllText(policyPath))
                policy["allowed_tools"] = Check.Json("[{\"harness\":\"claude\",\"provider\":\"anthropic\"}]")
                policy["models"] = Check.Json("{\"claude-sonnet-5-5\":[\"high\"]}")
                Check.SaveJson(policyPath, policy)
                Directory.CreateDirectory(Path.Combine(flow.Upstream, ".codex"))
                File.WriteAllText(Path.Combine(flow.Upstream, ".codex/config.toml"), "")
                flow.Commit("Claude managed fixture")
                flow.Approve()
                let profile = Path.Combine(flow.Temp.Root, "claude-profile")
                Directory.CreateDirectory(
                    profile,
                    UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                )
                File.WriteAllText(Path.Combine(profile, ".claude.json"), mode)
                File.WriteAllText(
                    Path.Combine(profile, ".credentials.json"),
                    Check.Map(
                        "loggedIn",
                        true,
                        "authMethod",
                        "claude.ai",
                        "apiProvider",
                        "firstParty",
                        "subscriptionType",
                        "pro"
                    )
                        .ToJsonString()
                )
                if mode == "normal" {
                    flow.Temp.Env["TERM"] = "dumb"
                    flow.Temp.Env["NO_COLOR"] = "1"
                    let wizardProfile = Path.Combine(flow.Temp.Root, "wizard-profile")
                    let cancelled = TestTerminal.Pty(
                        binary,
                        []string{
                            "work",
                            "owner/project",
                            "--issue",
                            "1",
                            "--seconds",
                            "60",
                            "--verification-reserve",
                            "20"
                        },
                        flow.Temp,
                        100,
                        "1\n" + wizardProfile + "\n1\n1\nq\n"
                    )
                    Check.That(cancelled.Code == 1, cancelled.Output + cancelled.Error)
                    Check.Contains(cancelled.Output, "Claude Code | Subscription")
                    Check.Contains(cancelled.Output, "Native fixture sign-in complete")
                    Check.Contains(cancelled.Output, "Review donation")
                    Check.That(
                        !cancelled.Output.Contains("Uses your Codex subscription"),
                        "Claude wizard claimed Codex billing"
                    )
                    flow.NoInference()
                    flow.NoPr()
                }
                flow.Call(
                    []string{
                        "defaults",
                        "set",
                        "--profile",
                        "claude",
                        "--harness",
                        "claude",
                        "--model",
                        "claude-sonnet-5-5",
                        "--effort",
                        "high",
                        "--claude-profile",
                        profile,
                        "--sole-use"
                    }
                )
                File.Delete(Path.Combine(flow.Bin, "codex"))
                File.Delete(Path.Combine(flow.Bin, "codex-impl"))
                let prepared = flow.Acquire(
                    []string{
                        "claim",
                        "--repo",
                        "owner/project",
                        "--issue",
                        "1",
                        "--profile",
                        "claude",
                        "--seconds",
                        "60",
                        "--verification-reserve",
                        "20",
                        "--runs",
                        Path.Combine(flow.Temp.Root, "runs")
                    }
                )
                let index = prepared.Output.LastIndexOf("Run: ")
                Check.That(index >= 0, "Claude claim did not return a run")
                let run = prepared.Output.Substring(index + 5).Trim()
                let original = File.ReadAllText(Path.Combine(profile, ".claude.json"))
                flow.Call([]string{"work", "--run", run, "--yes", "--non-interactive"}, mode == "normal" ? 0: 1)
                let saved = Check.Json(File.ReadAllText(Path.Combine(run, "run.json")))
                Check.That(
                    Check.Text(saved["claude_version"]) == "100.0.0 (Claude Code)",
                    "Claude version was not recorded"
                )
                Check.That(
                    Check.Text(saved["state"]) == (mode == "normal" ? "generated": "failed"),
                    "Claude completion state is wrong"
                )
                Check.That(
                    Check.Text(saved["observed_invocation"]?["model"]) == "claude-sonnet-5-5",
                    "Claude invocation lost exact model"
                )
                Check.That(
                    original == File.ReadAllText(Path.Combine(profile, ".claude.json")),
                    "Task changed its native profile"
                )
                if mode == "normal" {
                    Check.That(
                        Check.Text(saved["verification"]?[0]?["exit_code"]) == "0",
                        "Claude skipped independent verification"
                    )
                    Check.That(
                        Check.Text(saved["usage"]?["cached_input_tokens"]) == "4",
                        "Claude cache usage was not mapped"
                    )
                    let status = Check.Envelope(flow.Call([]string{"status", "--run", run, "--json"}), "status", "ok")
                    Check.That(
                        Check.Text(status["data"]?["claude_version"]) == "100.0.0 (Claude Code)",
                        "Claude status lost native version"
                    )
                    Check.That(Check.Text(saved["usage"]?["input_tokens"]) == "12", "Claude usage was not preserved")
                    flow.Publish(run)
                    Check.Contains(flow.Body(), "claude")
                    Check.That(!flow.Body().Contains(profile), "Public summary disclosed the private profile")
                } else {
                    Check.That(
                        saved["turn_completed"] == nil && saved["commit"] == nil,
                        "Failed Claude turn was accepted"
                    )
                    flow.NoPr()
                }
                flow.Call([]string{"work", "--run", run, "--yes", "--non-interactive"}, 1)
            }
            Console.WriteLine(
                "PASS Claude managed profile, claim, work, verification, publication and completion refusal"
            )
        }

        internal func All(binary string) {
            Managed(binary)
            using let data = Temp()
            data.Tool("claude")
            let policyPath = Path.Combine(data.Root, "tokate.json")
            let policy = Check.Json(TestResources.Template("tokate.json"))
            policy["models"] = Check.Json("{\"claude-opus-5-5\":[\"high\"]}")
            policy["allowed_tools"] = Check.Json("[{\"harness\":\"claude\",\"provider\":\"anthropic\"}]")
            Check.SaveJson(policyPath, policy)
            let profile = Path.Combine(data.Root, "profile")
            Directory.CreateDirectory(
                profile,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
            )
            let mode = Path.Combine(profile, ".claude.json")
            let statusPath = Path.Combine(profile, ".credentials.json")
            File.WriteAllText(mode, "normal")
            let status = Check.Map(
                "loggedIn",
                true,
                "authMethod",
                "claude.ai",
                "apiProvider",
                "firstParty",
                "subscriptionType",
                "pro",
                "orgId",
                "PRIVATE_ORG",
                "orgName",
                "PRIVATE_NAME"
            )
            let words = []string{
                "claude-capabilities",
                "--claude",
                Path.Combine(data.Root, "bin/claude"),
                "--claude-profile",
                profile,
                "--sole-use",
                "--model",
                "claude-opus-5-5",
                "--effort",
                "high",
                "--json",
                "--policy",
                policyPath
            }
            for plan in[]string{"pro", "max"} {
                status["subscriptionType"] = JsonValue.Create(plan)
                File.WriteAllText(statusPath, status.ToJsonString())
                let result = TestProcess.Run(binary, words, data.Env)
                let envelope = Check.Envelope(result, "claude-capabilities", "ok")
                let value = envelope["data"] ?? throw Exception("Missing gate data")
                Check.That(
                    value["auth_status"]?.AsObject().Count == 4 && Check.Text(
                        value["auth_status"]?["subscriptionType"]
                    ) == plan,
                    "Auth status did not retain exactly the four approved fields"
                )
                Check.That(
                    !result.Output.Contains("PRIVATE_") && Check.Text(value["managed_execution_enabled"]) == "true",
                    "Gate leaked organization metadata or lost managed capability"
                )
                Check.That(
                    Check.Text(value["version"]) == "100.0.0 (Claude Code)",
                    "Gate pinned an exact native version"
                )
                Check.Contains(value["invocation"]?.ToJsonString() ?? "", "claude-opus-5-5")
                Check.That(value["native_reports"] == nil, "Gate invented native reports")
            }
            let checkout = Path.Combine(data.Root, "checkout")
            Directory.CreateDirectory(Path.Combine(checkout, ".git"))
            Directory.CreateDirectory(Path.Combine(checkout, ".github"))
            File.Copy(policyPath, Path.Combine(checkout, ".github/tokate.json"))
            let local = List[string](words)
            local.RemoveRange(local.Count - 2, 2)
            local.AddRange([]string{"--path", checkout})
            Check.Envelope(TestProcess.Run(binary, local.ToArray(), data.Env), "claude-capabilities", "ok")
            policy["models"] = Check.Json("{\"claude-sonnet-5-5\":[\"medium\"]}")
            Check.SaveJson(policyPath, policy)
            words[7] = "claude-sonnet-5-5"
            words[9] = "medium"
            let changed = Check.Envelope(TestProcess.Run(binary, words, data.Env), "claude-capabilities", "ok")["data"]
            Check.That(
                Check.Text(changed?["requested"]?["model"]) == words[7] && Check.Text(
                    changed?["requested"]?["effort"]
                ) == words[9],
                "Changed owner model/effort policy did not reach the native invocation"
            )
            let invocation = List[string]()
            for word in changed?["invocation"]?.AsArray() ?? throw Exception("Missing invocation") {
                invocation.Add(Check.Text(word))
            }
            Check.That(invocation[invocation.IndexOf("--model") + 1] == words[7], "Native model was not selected")
            Check.That(invocation[invocation.IndexOf("--effort") + 1] == words[9], "Native effort was not selected")
            let settings = Check.Json(invocation[invocation.IndexOf("--settings") + 1])
            Check.That(Check.Text(settings["availableModels"]?[0]) == words[7], "Native model restriction was fixed")
            let changedReport = Path.Combine(data.Root, "selected.jsonl")
            File.WriteAllText(
                changedReport,
                Check.Map("type", "system", "subtype", "init", "model", words[7], "effort", words[9]).ToJsonString() +
                    "\n"
            )
            let reported = List[string](words)
            reported.AddRange([]string{"--file", changedReport})
            let evidence = Check.Envelope(
                TestProcess.Run(binary, reported.ToArray(), data.Env),
                "claude-capabilities",
                "ok"
            )
            Check.That(
                Check.Text(evidence["data"]?["native_reports"]?["model"]) == words[7] && Check.Text(
                    evidence["data"]?["native_reports"]?["effort"]
                ) == words[9],
                "Matching reports were not accepted for the selected pair"
            )
            policy["allowed_tools"] = Check.Json("[{\"harness\":\"codex\",\"provider\":\"openai\"}]")
            Check.SaveJson(policyPath, policy)
            Check.Contains(
                TestProcess.Run(binary, words, data.Env).Output,
                "Claude/anthropic is not allowed by the repository policy"
            )
            policy["models"] = Check.Json("{\"claude-opus-5-5\":[\"high\"]}")
            policy["allowed_tools"] = Check.Json("[{\"harness\":\"claude\",\"provider\":\"anthropic\"}]")
            Check.SaveJson(policyPath, policy)
            words[7] = "claude-opus-5-5"
            words[9] = "high"
            for pair in[]string{
                "loggedIn=false",
                "loggedIn=true",
                "authMethod=oauth_token",
                "authMethod=api_key",
                "apiProvider=bedrock",
                "subscriptionType=team",
                "subscriptionType=enterprise",
                "subscriptionType=free"
            } {
                let rejected = status.DeepClone()
                let parts = pair.Split('=')
                rejected[parts[0]] = parts[1] == "false" ? JsonValue.Create(false): JsonValue.Create(parts[1])
                File.WriteAllText(statusPath, rejected.ToJsonString())
                let result = TestProcess.Run(binary, words, data.Env)
                Check.That(
                    result.Code == 1 && !result.Output.Contains("PRIVATE_"),
                    "Unsupported auth schema was accepted or leaked"
                )
            }
            File.WriteAllText(statusPath, status.ToJsonString())
            for effort in[]string{"xhigh", "medium", "max"} {
                let rejected = List[string](words)
                rejected[9] = effort
                let result = TestProcess.Run(binary, rejected.ToArray(), data.Env)
                Check.That(
                    result.Code == 1 && result.Output.Contains("not allowed by the repository policy"),
                    "Disallowed effort was launched"
                )
            }
            let alias = List[string](words)
            alias[7] = "opus"
            Check.That(
                TestProcess
                    .Run(binary, alias.ToArray(), data.Env)
                    .Output
                    .Contains("not allowed by the repository policy"),
                "Model alias was not refused before native launch"
            )
            File.WriteAllText(mode, "missing")
            Check.That(
                TestProcess.Run(binary, words, data.Env).Code == 1,
                "Missing permission-prompts control was accepted"
            )
            File.WriteAllText(mode, "normal")
            File.WriteAllText(Path.Combine(profile, "settings.json"), "{}")
            Check.That(TestProcess.Run(binary, words, data.Env).Code == 1, "Mixed settings profile was accepted")
            File.Delete(Path.Combine(profile, "settings.json"))
            data.Env["ANTHROPIC_API_KEY"] = "synthetic-only"
            Check.That(TestProcess.Run(binary, words, data.Env).Code == 1, "Environment-token profile was accepted")
            data.Env.Remove("ANTHROPIC_API_KEY")
            let report = Path.Combine(data.Root, "report.jsonl")
            let withReport = List[string](words)
            withReport.AddRange([]string{"--file", report})
            let profileReport = List[string](withReport)
            profileReport[profileReport.Count - 1] = statusPath
            Check.That(
                TestProcess
                    .Run(binary, profileReport.ToArray(), data.Env)
                    .Output
                    .Contains("outside the native-login profile"),
                "Gate opened profile contents as a native report"
            )
            File.WriteAllText(
                report,
                "{\"type\":\"system\",\"subtype\":\"init\",\"model\":\"claude-opus-5-5\",\"permissionMode\":\"default\"}\n{\"type\":\"result\",\"usage\":{\"input_tokens\":12}}\n"
            )
            let parsed = Check
                .Envelope(TestProcess.Run(binary, withReport.ToArray(), data.Env), "claude-capabilities", "ok")[
                "data"
            ]?["native_reports"]
            Check.That(
                parsed?["effort"] == nil && Check.Text(parsed?["usage"]?["input_tokens"]) == "12",
                "Reports invented effort or lost native usage"
            )
            for field in[]string{
                "\"model\":\"claude-sonnet-4-6\"",
                "\"effort\":\"low\"",
                "\"permissionMode\":\"dontAsk\"",
                "\"modelUsage\":{\"claude-haiku-4-5\":{}}"
            } {
                File.WriteAllText(
                    report,
                    "{\"type\":\"system\",\"subtype\":\"init\"," + field + "}\n{\"type\":\"result\"," + field + "}\n"
                )
                Check.That(
                    TestProcess.Run(binary, withReport.ToArray(), data.Env).Code == 1,
                    "Conflicting native report was accepted"
                )
            }
            Console.WriteLine(
                "PASS Claude gate native interfaces, auth schema, metadata refusal, exact choices and report conflicts"
            )
        }
    }
}
