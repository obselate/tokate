package TokateTests

import Gsharp.Concurrency
import Microsoft.Win32.SafeHandles
import System
import System.Collections.Generic
import System.Diagnostics
import System.Globalization
import System.IO
import System.Net
import System.Net.Sockets
import System.Text.Json.Nodes

internal partial class NativeFlow : NativeFixture {
    internal init(binary string) : base(binary) { }

    internal func MissingTools() {
        let empty = Path.Combine(Temp.Root, "empty")
        Directory.CreateDirectory(empty)
        Temp.Env["PATH"] = empty
        let help = Call([]string{"--help"})
        Check.Contains(help.Output, "toh-KAH-teh")
        Check.That(help.Error == "", "Help emitted prerequisite warnings")
        Check.That(!(help.Output + help.Error).Contains('\u001b'), "Redirected output contains ANSI")
        let doctor = Call([]string{"doctor"}, 1)
        for name in[]string{"git", "gh", "setsid"} {
            Check.Contains(doctor.Output, name + ": missing")
        }
        Check.That(!doctor.Output.Contains("codex: missing"), "Default doctor required Codex")
        let work = Call(
            []string{"work", "--repo", "owner/project", "--issue", "1", "--model", "model", "--effort", "high"},
            1
        )
        Check.Contains(work.Error, "Install or repair the tools needed")
        NoInference()
    }

    internal func OwnerWithoutCodex() {
        let codex = Path.Combine(Bin, "codex")
        File.Delete(codex)
        File.WriteAllText(codex, "not executable")
        let result = Call([]string{"approve", "--repo", "owner/project", "--issue", "1"}, owner: true)
        Check.That(result.Error == "", "Owner command warned about donor tools")
        Check.Contains(result.Output, "Approval recorded")
        Check.Contains(
            Call(
                []string{"work", "--repo", "owner/project", "--issue", "1", "--model", "model", "--effort", "high"},
                1
            ).Error,
            "Install or repair the tools needed"
        )
    }

    internal func DoctorToolchain() {
        let env = Dictionary[string, string](Temp.Env)
        let global = Path.Combine(Upstream, "global.json")
        File.Copy(Path.Combine(Directory.GetCurrentDirectory(), "global.json"), global)
        let ready = TestProcess.Run(Binary, []string{"doctor", "--managed"}, env, cwd: Upstream)
        Check.Success(ready)
        Check.Contains(ready.Output, "Repository global.json SDK/MSBuild starts inside the sandbox")
        File.WriteAllText(global, "{\"sdk\":{\"version\":\"99.0.100\",\"rollForward\":\"disable\"}}")
        let missing = TestProcess.Run(Binary, []string{"doctor", "--managed"}, env, cwd: Upstream)
        Check.That(missing.Code == 1, "Doctor accepted unavailable pinned SDK")
        Check.Contains(missing.Output, "toolchain: failed")
        Check.Contains(missing.Output, "standard system path")
        File.Delete(global)
        let unpinned = TestProcess.Run(Binary, []string{"doctor", "--managed"}, env, cwd: Upstream)
        Check.Success(unpinned)
        Check.Contains(unpinned.Output, "sandbox: ready")
        Check.That(!unpinned.Output.Contains("Repository global.json"), "Doctor claimed an absent SDK pin")
        let outside = Path.Combine(Temp.Root, "outside-global.json")
        File.Copy(Path.Combine(Directory.GetCurrentDirectory(), "global.json"), outside)
        File.CreateSymbolicLink(global, outside)
        for dangling in[]bool{false, true} {
            if dangling {
                File.Delete(outside)
            }
            let linked = TestProcess.Run(Binary, []string{"doctor", "--managed"}, env, cwd: Upstream)
            Check.That(linked.Code == 1, "Doctor accepted a linked SDK file")
            Check.Contains(linked.Output, "not a symbolic link")
        }
        File.Delete(global)
        NoInference()
    }

    internal func StructuredContract() {
        let approval = Call([]string{"approve", "--repo", "owner/project", "--issue", "1", "--json"}, owner: true)
        Check.Envelope(approval, "approve", "ok")
        let policy = Call([]string{"policy", "--repo", "owner/project", "--json"})
        let value = Check.Envelope(policy, "policy", "ok")
        Check.That(Check.Text(value["data"]?["policy"]?["version"]) == "2", "Missing projected policy")
        let legacy = Check.Json(Call([]string{"policy", "--repo", "owner/project"}).Output)
        Check.That(
            legacy["schema_version"] == nil && Check.Text(legacy["version"]) == "2",
            "Legacy piped policy changed"
        )
        let claim = Check.Envelope(Acquire(ClaimArgs(json: true)), "claim", "ok")
        let run = Check.Text(claim["data"]?["run"])
        Check.That(Path.IsPathFullyQualified(run), "Claim omitted executable run path")
        NoInference()
        let work = Call([]string{"work", "--run", run, "--json", "--traffic"})
        Check.Envelope(work, "work", "ok")
        Check.Contains(work.Error, "Running gpt-6.1-sol")
        Check.Contains(work.Error, "Tokate API traffic:")
        Check.That(
            !work.Output.Contains("synthetic-raw") && !work.Output.Contains("synthetic-usage-secret"),
            "Inference output leaked"
        )
        Publish(run)
        Check.Envelope(
            Call([]string{"verify-pr", "--repo", "owner/project", "--pr", "10", "--json"}, owner: true),
            "verify-pr",
            "ok"
        )
        Check.Envelope(Call([]string{"checks", "--run", run, "--json"}, 8), "checks", "pending")
        Check.Envelope(
            Call([]string{"checks", "--run", run, "--watch", "--timeout", "1", "--json"}, 8),
            "checks",
            "pending"
        )
        for outcome in[]string{"fail", "pass"} {
            Reload()
            State["checks"] = Check.Json(
                "[{\"name\":\"verify\",\"bucket\":\"" + outcome + "\",\"output\":\"synthetic-check-log-marker\"}]"
            )
            Save()
            let result = Call(
                []string{"checks", "--repo", "owner/project", "--pr", "10", "--json"},
                outcome == "pass" ? 0: 1
            )
            let check = Check.Envelope(
                result,
                "checks",
                outcome == "pass" ? "ok": "error",
                outcome == "pass" ? "": "verification_failed"
            )
            Check.That(check["data"]?["checks"]?.AsArray().Count == 1, "Missing check summary")
            Check.That(!result.Output.Contains("synthetic-check-log-marker"), "Raw check data leaked")
        }
        File.SetUnixFileMode(
            Path.Combine(Bin, "codex-impl"),
            UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
        )
        Check.Envelope(Call([]string{"work", "--run", run, "--json"}, 1), "work", "error", "invalid_state")
        Reload()
        Check.That(Check.Text(State["exec_count"]) == "1", "JSON or suggestions spent extra inference")
        Approve()
        Reload()
        let originalPulls = State["pulls"]?.ToJsonString() ?? ""
        Check.Envelope(
            Call([]string{"verify-pr", "--repo", "owner/project", "--pr", "10", "--json"}, 1, owner: true),
            "verify-pr",
            "error",
            "stale_approval"
        )
        Reload()
        Check.That(Check.Text(State["exec_count"]) == "1", "Receipt rejection spent inference")
        Check.That((State["pulls"]?.ToJsonString() ?? "") == originalPulls, "Receipt rejection changed the PR")
        Call([]string{"revoke", "--repo", "owner/project", "--issue", "1"}, owner: true)
        Check.Envelope(Call([]string{"submit", "--run", run, "--json"}, 1), "submit", "error", "stale_approval")
    }

    internal func StructuredFailures() {
        using let flow = NativeFlow(Binary)
        flow.Initialize()
        flow.Approve()
        let run = flow.Claim(seconds: "1")
        File.WriteAllText(Path.Combine(flow.Temp.Env["CODEX_HOME"], "identity"), "No active login")
        let failure = flow.Call([]string{"work", "--run", run, "--json"}, 1)
        let value = Check.Envelope(failure, "work", "error", "authentication_required")
        Check.That(
            Check.Text(value["next_actions"]?[0]?[0]) == "codex" && Check.Text(
                value["next_actions"]?[0]?[1]
            ) == "login",
            "Missing complete authentication action"
        )
        flow.NoInference()
        flow.NoPr()
        EventDelimiters()
    }

    private func EventDelimiters() {
        let started = "{\"type\":\"turn.started\"}\n{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"Fixture completed.\"}}"
        let completed = "{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":7,\"output_tokens\":3}}"
        let streams = []string{
            String('\n', 1024 * 1024) + started + "\n \t\r\n" + completed + "\n\n",
            "\r\n" + started + "\r\n\r\n" + completed + "\r\n",
            started + "\n" + completed.Replace(",\"usage\"", "\r,\"usage\"") + "\n",
            started + "\r" + completed
        }
        for i in 0 ... streams.Length {
            using let flow = NativeFlow(Binary)
            flow.Initialize()
            flow.Approve()
            let run = flow.Claim(seconds: "30")
            flow.Reload()
            flow.State["event_stream"] = JsonValue.Create(streams[i])
            flow.Save()
            let valid = i < streams.Length - 1
            let result = flow.Call([]string{"work", "--run", run, "--json"}, valid ? 0: 1)
            Check.Envelope(result, "work", valid ? "ok": "error", valid ? "": "inference_failed")
            let saved = Check.Json(File.ReadAllText(Path.Combine(run, "run.json")))
            if valid {
                Check.That(
                    Check.Text(saved["usage"]?["input_tokens"]) == "7" && Check.Text(
                        saved["usage"]?["output_tokens"]
                    ) == "3",
                    "Event delimiter changed completed usage"
                )
            } else {
                Check.That(saved["usage"] == nil && saved["turn_completed"] == nil, "Lone CR split two events")
                flow.NoPr()
            }
            flow.Reload()
            Check.That(Check.Text(flow.State["exec_count"]) == "1", "Event delimiter fixture retried inference")
        }
    }

    internal func CrossAccountFlow() {
        Approve()
        let run = Claim()
        Call([]string{"work", "--run", run})
        Publish(run)
        Reload()
        Check.That(Check.Text(State["exec_count"]) == "1", "Publication repeated inference")
        Check.That(Check.Text(State["pulls"]?[0]?["draft"]) == "true", "PR must be draft")
        CommitIdentity(
            Path.Combine(Bin, "fork"),
            Check.Text(State["pulls"]?[0]?["head"]?["sha"]),
            "donor",
            "tokate@users.noreply.github.com"
        )
        Call([]string{"verify-pr", "--repo", "owner/project", "--pr", "10"}, owner: true)
    }

    internal func ModelPolicyMalformed() {
        let path = Path.Combine(Upstream, ".github/tokate.json")
        let original = Check.Json(File.ReadAllText(path))
        original.AsObject().Remove("models")
        let text = original.ToJsonString()
        for fixture in[][]string{
            []string{"\"model_policy\":null", "model_policy must be exactly whitelist or unrestricted"},
            []string{"\"model_policy\":true", "model_policy must be exactly whitelist or unrestricted"},
            []string{"\"model_policy\":1", "model_policy must be exactly whitelist or unrestricted"},
            []string{"\"model_policy\":[]", "model_policy must be exactly whitelist or unrestricted"},
            []string{"\"model_policy\":{}", "model_policy must be exactly whitelist or unrestricted"},
            []string{"\"model_policy\":\"other\"", "model_policy must be exactly whitelist or unrestricted"},
            []string{"\"model_policy\":\"whitelist\",\"model_policy\":\"unrestricted\"", "Duplicate JSON key"},
            []string{"\"model_policy\":\"unrestricted\",\"model_policy\":\"unrestricted\"", "Duplicate JSON key"},
            []string{
                "\"model_policy\":\"unrestricted\",\"models\":{\"model\":[\"high\"]}",
                "Unrestricted model policy requires omitted models or an empty object"
            },
            []string{
                "\"model_policy\":\"unrestricted\",\"models\":null",
                "Unrestricted model policy requires omitted models or an empty object"
            },
            []string{
                "\"model_policy\":\"unrestricted\",\"models\":[]",
                "Unrestricted model policy requires omitted models or an empty object"
            },
            []string{
                "\"model_policy\":\"unrestricted\",\"models\":\"bad\"",
                "Unrestricted model policy requires omitted models or an empty object"
            },
            []string{"\"model_policy\":\"unrestricted\",\"models\":{},\"models\":{}", "Duplicate JSON key"},
            []string{"\"model_policy\":\"whitelist\"", "Policy models must map model names to effort arrays"},
            []string{"\"model_policy\":\"whitelist\",\"models\":{}", "Set models and a max_seconds limit"},
            []string{
                "\"model_policy\":\"whitelist\",\"models\":null",
                "Policy models must map model names to effort arrays"
            },
            []string{"\"model_policy\":\"whitelist\",\"models\":{\"bad model\":[\"high\"]}", "Invalid model name"},
            []string{"\"model_policy\":\"whitelist\",\"models\":{\"model\":[]}", "Each model needs allowed efforts"},
            []string{
                "\"model_policy\":\"whitelist\",\"models\":{\"model\":\"high\"}",
                "Each model needs allowed efforts"
            },
            []string{"\"model_policy\":\"whitelist\",\"models\":{\"model\":[null]}", "Invalid reasoning effort"},
            []string{
                "\"model_policy\":\"whitelist\",\"models\":{\"model\":[\"high,xhigh\"]}",
                "Invalid reasoning effort"
            },
            []string{"\"models\":{}", "Set models and a max_seconds limit"},
            []string{"\"models\":null", "Policy models must map model names to effort arrays"},
            []string{"\"models\":{\"model\":[\"absent\"]}", "Invalid reasoning effort"},
        } {
            File.WriteAllText(path, text.Substring(0, text.Length - 1) + "," + fixture[0] + "}")
            Commit("Malformed model policy fixture")
            Reject([]string{"policy", "--repo", "owner/project"}, fixture[1])
        }
    }

    internal func MissingFork() {
        Approve()
        using let baseline = FixtureSnapshot(Temp.Root)
        Reload()
        State["missing_fork"] = JsonValue.Create(true)
        Save()
        let run = Claim()
        Reload()
        Check.That(Check.Text(State["fork_creations"]) == "1", "Missing fork was not created once")
        Check.That(Directory.Exists(Path.Combine(run, "checkout")), "Missing fork checkout was not prepared")
        NoInference()
        for status in[]int32{0, 403} {
            baseline.Restore()
            let faults = JsonArray()
            for i in 0 ... 3 {
                faults.Add(Check.Map("status", status, "message", "Forbidden"))
            }
            Faults("repos/donor/project", faults)
            let failure = Acquire(
                []string{
                    "claim",
                    "--repo",
                    "owner/project",
                    "--issue",
                    "1",
                    "--model",
                    "gpt-6.1-sol",
                    "--effort",
                    "high"
                    ,
                    "--seconds",
                    "30"
                },
                1,
                traffic: true
            )
            Check.Contains(failure.Error, "GitHub read failed")
            Check.That(!failure.Error.Contains("Create a writable fork"), "Non-404 error was treated as missing")
            Reload()
            Check.That(State["fork_creations"] == nil, "Failed fork lookup created a repository")
            NoInference()
        }
    }

    internal func ManagedCancellation() {
        Approve()
        let run = Claim(seconds: "30")
        Mode("timeout")
        File.Copy(Binary, Path.Combine(Temp.Root, "tokate-runner"))
        let info = TestProcess.StartInfo(
            "/usr/bin/script",
            []string{
                "-q",
                "-e",
                "-c",
                "echo $$$$ > runner.pid; exec ./tokate-runner work --run '" + run + "'",
                "/dev/null"
            },
            Temp.Env,
            Temp.Root
        )
        using let terminal = Process.Start(info) ?? throw Exception("Cannot start managed cancellation fixture")
        try {
            terminal.StandardInput.Close()
            let events = Path.Combine(run, "events.jsonl")
            var ready bool
            for i in 0 ... 1000 {
                if File.Exists(events) && File.ReadAllText(events).Contains("partial-secret") && File.Exists(
                    Path.Combine(run, "stderr.log")
                ) &&
                    File
                    .ReadAllText(Path.Combine(run, "stderr.log")).Contains("synthetic-partial-stderr-secret") {
                    ready = true
                    break
                }
                select {
                    case <- after(TimeSpan.FromMilliseconds(10.0)) { }
                }
            }
            Check.That(ready, "Managed cancellation did not flush evidence")
            let pid = File.ReadAllText(Path.Combine(Temp.Root, "runner.pid")).Trim()
            Check.Success(TestProcess.Run("/usr/bin/kill", []string{"-INT", pid}, Temp.Env))
            Check.That(terminal.WaitForExit(5000), "Managed cancellation did not finish cleanup")
            let output = terminal.StandardOutput.ReadToEnd() + terminal.StandardError.ReadToEnd()
            Check.That(terminal.ExitCode != 0, "Managed cancellation became success")
            Check.Contains(output, "cancelled")
            Check.That(!output.Contains("partial-secret"), "Raw managed cancellation output escaped")
            let saved = Check.Json(File.ReadAllText(Path.Combine(run, "run.json")))
            Check.That(
                Check.Text(saved["state"]) == "failed" && Check.Text(
                    saved["failure_reason"]
                ) == "inference_interrupted",
                "Managed cancellation lost terminal reason"
            )
            Check.That(
                saved["inference_exit_code"] == nil && saved["usage"] == nil,
                "Managed cancellation fabricated completion"
            )
            Check.That(
                File.ReadAllText(Path.Combine(run, "checkout/partial.txt")) == "partial-edit",
                "Cancelled edit lost"
            )
            TestProcess.Collected(
                File.ReadAllText(Path.Combine(Bin, "child.pid")),
                "Managed descendant survived cancellation"
            )
            Call([]string{"work", "--run", run}, 1)
            Reload()
            Check.That(Check.Text(State["exec_count"]) == "1", "Managed cancellation retried inference")
            NoPr()
        } finally {
            if !terminal.HasExited {
                terminal.Kill(true)
                terminal.WaitForExit()
            }
        }
    }

    internal func EmptyProtectedPaths() {
        ProtectedPolicy(true)
        Approve()
        let run = Claim()
        Mode("protected_entrypoint")
        Call([]string{"work", "--run", run})
        Publish(run)
        Call([]string{"verify-pr", "--repo", "owner/project", "--pr", "10"}, owner: true)
    }

    internal func GitEvidence() {
        using let flow = NativeFlow(Binary)
        flow.Initialize()
        flow.Approve()
        let run = flow.Claim()
        using let baseline = FixtureSnapshot(flow.Temp.Root)
        for fault in[]string{"missing-nul", "invalid-utf8", "truncated"} {
            baseline.Restore()
            flow.DiffFault("git_diff_fault", fault)
            Check.Contains(flow.Call([]string{"work", "--run", run}, 1).Error, "Git path evidence")
            flow.NoPr()
        }
    }

    internal func RepositoryConfig() {
        Directory.CreateDirectory(Path.Combine(Upstream, ".codex"))
        File.WriteAllText(Path.Combine(Upstream, ".codex/config.toml"), "sandbox_mode=\"danger-full-access\"")
        Commit("Agent config")
        Git("-C", Path.Combine(Bin, "fork"), "fetch", Upstream, "main")
        Approve()
        Claim(code: 1)
        let directories = Directory.GetDirectories(Path.Combine(Temp.Root, "runs"))
        Check.That(directories.Length == 1, "Rejected repository configuration lost preparation")
        Check.Contains(Call([]string{"prepare", "--run", directories[0]}, 1).Error, "Repository Codex configuration")
        NoInference()
    }

    internal func PublicContent(run string) {
        Reload()
        let saved = Check.Json(File.ReadAllText(Path.Combine(run, "request.json")))
        let body = Body()
        Check.Contains(body, "Donor-reported: original owner checks passed locally")
        for value in[]string{
            "synthetic-raw",
            "synthetic-usage-secret",
            "synthetic-repository-secret",
            Temp.Root,
            "cached_input_tokens",
            "extra"
        } {
            Check.That(!saved.ToJsonString().Contains(value), "Local data reached publication: " + value)
        }
        if State["pulls"] != nil {
            Check.That(Check.Text(State["pulls"]?[0]?["body"]) == body, "PR differs from inspectable publication")
        }
        Check.Contains(File.ReadAllText(Path.Combine(run, "report.md")), "synthetic-raw-report-secret")
        Check.Contains(File.ReadAllText(Path.Combine(run, "events.jsonl")), "synthetic-raw-event-secret")
        Check.Contains(File.ReadAllText(Path.Combine(run, "stderr.log")), "synthetic-raw-stderr-secret")
    }

    internal func OutputBoundary() {
        File.WriteAllText(Path.Combine(Upstream, ".env"), "synthetic-repository-secret")
        File.WriteAllText(Path.Combine(Upstream, "ordinary.data"), "synthetic-repository-secret")
        let path = Path.Combine(Upstream, ".github/tokate.json")
        let policy = Check.Json(File.ReadAllText(path))
        policy["verification"] = Check.Json(
            "[[\"/bin/sh\",\"-c\",\"test -f result.txt && test -z \\\"$$GH_TOKEN$$CODEX_HOME$$UNRELATED_DONOR_VALUE$$OPENAI_API_KEY\\\" && printf synthetic-raw-verification-secret && printf synthetic-raw-verification-error >&2\"]]"
        )
        File.WriteAllText(path, policy.ToJsonString())
        Commit("Synthetic repository/output boundary")
        Git("-C", Path.Combine(Bin, "fork"), "fetch", Upstream, "main")
        Approve()
        let run = Claim()
        Mode("output_boundary")
        Call([]string{"work", "--run", run})
        Publish(run)
        PublicContent(run)
        let verification = File.ReadAllText(Path.Combine(run, "verification.json"))
        Check.Contains(verification, "synthetic-raw-verification-secret")
        Check.Contains(verification, "synthetic-raw-verification-error")
        Call([]string{"verify-pr", "--repo", "owner/project", "--pr", "10"}, owner: true)
    }

    internal func ToolAuthentication() {
        Temp.Env.Remove("GH_TOKEN")
        Temp.Env.Remove("GITHUB_TOKEN")
        State["stored_login"] = JsonValue.Create(true)
        Save()
        Approve()
        let run = Claim()
        Call([]string{"work", "--run", run})
        Publish(run)
        Reload()
        Check.That(Check.Text(State["helper_used"]) == "true", "Git did not use GitHub CLI authentication")
        Call([]string{"verify-pr", "--repo", "owner/project", "--pr", "10"}, owner: true)
    }

    internal func CanonicalVerification() {
        using let flow = NativeFlow(Binary)
        flow.Initialize()
        flow.Approve()
        let run = flow.Claim()
        using let baseline = FixtureSnapshot(flow.Temp.Root)
        for mode in[]string{"replacement", "graft", "index_assume", "index_skip"} {
            baseline.Restore()
            flow.Mode(mode)
            let failure = flow.Call([]string{"work", "--run", run}, 1)
            Check.Contains(
                failure.Error,
                mode == "replacement" ? "protected owner configuration":
                mode == "graft" ? "info/grafts": "Candidate index"
            )
            Check.That(!File.Exists(Path.Combine(run, "verification.json")), "Unsafe candidate reached verification")
            Check.That(File.Exists(Path.Combine(run, "checkout/result.txt")), "Blocked work was removed")
            flow.NoPr()
            flow.Reload()
            Check.That(Check.Text(flow.State["exec_count"]) == "1", "Guard retried inference")
        }
    }

    internal func ConditionalClaim() {
        using let flow = NativeFlow(Binary)
        flow.Initialize()
        flow.ApproveSelf()
        using let baseline = FixtureSnapshot(flow.Temp.Root)
        for mode in[]string{
            "strong",
            "weak",
            "weak-to-strong",
            "strong-to-weak",
            "missing",
            "empty",
            "bound",
            "weak-bound",
            "backslash"
        } {
            baseline.Restore()
            flow.ETags(mode)
            if mode == "empty" || mode == "bound" || mode == "weak-bound" || mode == "backslash" {
                let opaque = mode == "empty" ? "": (
                    mode == "backslash" ? "a\\b!": String('x', mode == "bound" ? 1022: 1020)
                )
                let tag = "\"" + opaque + "\""
                flow.State["etag_initial"] = JsonValue.Create(mode == "backslash" || mode == "bound" ? tag: "W/" + tag)
                flow.State["etag_returned"] = JsonValue.Create(mode == "backslash" ? "W/" + tag: tag)
                flow.Save()
            }
            flow.ResetTraffic()
            let claimed = flow.SameRepositoryClaim()
            let run = claimed.Output.Substring(claimed.Output.LastIndexOf("Run: ") + 5).Trim()
            let saved = Check.Json(File.ReadAllText(Path.Combine(run, "run.json")))
            Check.That(Check.Text(saved["state"]) == "claimed", "Equivalent ETags blocked claim: " + mode)
            Check.That(Check.Text(saved["head_repo"]) == "owner/project", "Claim did not reuse upstream repository")
            flow.NoInference()
            flow.NoPr()
        }
    }

    internal func ConditionalValidators() {
        ApproveSelf()
        for initial in[]bool{false, true} {
            for tag in[]string{
                "opaque",
                "w/\"opaque\"",
                "W /\"opaque\"",
                "W/W/\"opaque\"",
                "W/\"",
                "\"opaque",
                "\"opaque\"suffix",
                "\"opa\"que\"",
                "\"opa que\"",
                "\"opa\tque\"",
                "\"opa\u0001que\"",
                "\"opa\u007fque\"",
                "\"opa\\\"que\"",
                "\"" + String('x', 1023) + "\"",
                "W/\"" + String('x', 1021) + "\""
            } {
                ETags("")
                if initial {
                    State["etag_initial"] = JsonValue.Create(tag)
                    State["etag_force_304"] = JsonValue.Create(true)
                }
                State["etag_returned"] = JsonValue.Create(tag)
                Save()
                ResetTraffic()
                let failed = SameRepositoryClaim(1)
                Check.Contains(failed.Error, "HTTP 304 without a matching in-memory body")
                Reload()
                let calls = State["api_calls"]?.AsArray() ?? throw Exception("Missing traffic evidence")
                Check.That(
                    Check.Text(calls[calls.Count - 1]?["conditional"]) == (initial ? "false": "true"),
                    "Malformed initial tag was cached"
                )
                for directory in Directory.Exists(Path.Combine(Temp.Root, "runs")) ? Directory.GetDirectories(
                    Path.Combine(Temp.Root, "runs")
                ): []string{} {
                    Check.That(
                        !Directory.Exists(Path.Combine(directory, "checkout")),
                        "Rejected 304 created a checkout"
                    )
                }
                NoInference()
                NoPr()
            }
        }
        for mode in[]string{"mismatch", "case", "missing-entry"} {
            ETags("")
            if mode == "missing-entry" {
                State["etag_initial"] = JsonValue.Create("")
                State["etag_returned"] = JsonValue.Create("")
                State["etag_force_304"] = JsonValue.Create(true)
            } else {
                State["etag_returned"] = JsonValue.Create(mode == "mismatch" ? "W/\"unrelated\"": "\"opaque\"")
                if mode == "case" {
                    State["etag_initial"] = JsonValue.Create("W/\"Opaque\"")
                }
            }
            Save()
            ResetTraffic()
            let failed = SameRepositoryClaim(1)
            Check.Contains(failed.Error, "HTTP 304 without a matching in-memory body")
            for directory in Directory.Exists(Path.Combine(Temp.Root, "runs")) ? Directory.GetDirectories(
                Path.Combine(Temp.Root, "runs")
            ): []string{} {
                Check.That(!Directory.Exists(Path.Combine(directory, "checkout")), "Unmatched 304 created a checkout")
            }
            NoInference()
            NoPr()
        }
    }

    internal func ConditionalApproval() {
        for tags in[]string{"weak-to-strong"} {
            for mode in[]string{"after_304_edit", "after_304_revoke"} {
                using let flow = NativeFlow(Binary)
                flow.Initialize()
                flow.Approve()
                let run = flow.Claim()
                flow.ETags(tags)
                flow.Mode(mode)
                flow.ResetTraffic()
                let failed = flow.Call([]string{"work", "--run", run, "--json"}, 1, traffic: true)
                Check.Envelope(failed, "work", "error", "stale_approval")
                flow.Reload()
                var live bool
                for call in flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                    if Check.Text(call["status"]) == "304" {
                        Check.That(Check.Text(call["conditional"]) == "true", "304 lacked a conditional request")
                        live = true
                    }
                }
                Check.That(live, "No live 304 preceded approval change")
                flow.NoPr()
                Check.That(Check.Text(flow.State["exec_count"]) == "", "Approval change launched or repeated inference")
            }
        }
    }

    internal func ReadTraffic() {
        for mode in[]string{"retry-after", "retry-date", "reset", "server", "transport"} {
            let faults = JsonArray()
            var headers string
            var status int32 = 429
            if mode == "retry-after" {
                headers = "Retry-After: 2\r\n"
            } else if mode == "retry-date" {
                headers = "Date: Wed, 01 Jan 2031 00:00:00 GMT\r\nRetry-After: Wed, 01 Jan 2031 00:00:02 GMT\r\n"
            } else if mode == "reset" {
                headers = "Date: Wed, 01 Jan 2031 00:00:00 GMT\r\nX-RateLimit-Remaining: 0\r\nX-RateLimit-Reset: 1924992002\r\n"
                status = 403
            } else {
                status = mode == "server" ? 503: 0
            }
            faults.Add(Check.Map("status", status, "headers", headers))
            Faults("repos/owner/project", faults)
            let timer = Stopwatch.StartNew()
            let result = Call([]string{"policy", "--repo", "owner/project"}, traffic: true)
            Check.That(
                timer.Elapsed.TotalSeconds >= (status == 0 || status == 503 ? 1.0: 2.0),
                "Server retry delay was ignored"
            )
            Check.That(Check.Text(Check.Json(result.Output)["version"]) == "2", "Retry lost policy result")
            Traffic(3, 0, 0, 1, result)
        }
        for status in[]int32{0, 503, 401, 404, 422, 304, 403, 429} {
            let faults = JsonArray()
            for i in 0 ... 3 {
                faults.Add(
                    Check.Map(
                        "status",
                        status,
                        "message",
                        status == 403 ? "You have exceeded a secondary rate limit.": "failure"
                    )
                )
            }
            Faults("repos/owner/project", faults)
            let failure = Call([]string{"policy", "--repo", "owner/project"}, 1, traffic: true)
            let retryable = status == 0 || status == 503
            Traffic(retryable ? 3: 1, 0, status == 304 ? 1: 0, retryable ? 2: 0, failure)
            if status == 403 || status == 429 {
                Check.Contains(failure.Error, "Retry at or after")
                Check.Contains(failure.Error, "in 60 seconds")
            }
            NoInference()
        }
        Faults("repos/owner/project", Check.Json("[{\"status\":429,\"headers\":\"Retry-After: 60\\r\\n\"}]"))
        let failure = Call([]string{"policy", "--repo", "owner/project"}, 1, traffic: true)
        Traffic(1, 0, 0, 0, failure)
        Check.Contains(failure.Error, "Retry at or after")
        Faults(
            "repos/owner/project",
            Check.Json("[{\"status\":503,\"pause_ms\":40000},{\"status\":503,\"pause_ms\":40000}]")
        )
        let timer = Stopwatch.StartNew()
        let timed = Call([]string{"policy", "--repo", "owner/project"}, 1, traffic: true)
        Check.That(timer.Elapsed.TotalSeconds >= 59.0, "Subprocesses escaped the total read deadline")
        Traffic(2, 0, 0, 1, timed)
    }

    internal func MutationTraffic() {
        for verb in[]string{"POST", "PATCH", "DELETE"} {
            if verb != "POST" {
                Approve()
            }
            let path = verb == "PATCH" ? "repos/owner/project/git/refs/heads/tokate/contributions/1":
            (
                verb == "DELETE" ? "repos/owner/project/issues/1/labels/tokate%3Aapproved": "repos/owner/project/git/trees"
            )
            Faults(path, Check.Json("[{\"status\":429,\"headers\":\"Retry-After: 2\\r\\n\"}]"))
            let result = verb == "DELETE" ? Call(
                []string{"revoke", "--repo", "owner/project", "--issue", "1"},
                1,
                owner: true,
                traffic: true
            ):
            Call([]string{"approve", "--repo", "owner/project", "--issue", "1"}, 1, owner: true, traffic: true)
            Reload()
            Check.That(Check.Text(State["fault_index"]) == "1", "Mutation retried a rate limit")
            Check.Contains(result.Error, "No automatic retry")
            Check.Contains(result.Error, "Retry at or after")
            Check.That(!result.Error.Contains("synthetic-response-secret"), "Mutation failure leaked output")
            NoInference()
            Faults("", JsonArray())
        }
    }

    internal func BackgroundCleanup() {
        Approve()
        let run = Claim()
        Mode("background")
        Call([]string{"work", "--run", run})
        TestProcess.Collected(File.ReadAllText(Path.Combine(Bin, "child.pid")), "Descendant survived normal completion")
    }

    internal func UnsupportedSandbox() {
        Approve()
        let run = Claim()
        Mode("unsupported_sandbox")
        Check.Contains(Call([]string{"work", "--run", run}, 1).Error, "Managed sandbox isolation probe failed.")
        NoInference()
        NoPr()
    }

    internal func VerificationNetwork() {
        let listener = TcpListener(IPAddress.Loopback, 0)
        listener.Start()
        try {
            let port = (listener.LocalEndpoint as IPEndPoint)?.Port.ToString() ?? throw Exception("No listener port")
            using let flow = NativeFlow(Binary)
            flow.Initialize()
            flow.VerificationPolicy("exec 3<>/dev/tcp/127.0.0.1/" + port)
            flow.Approve()
            let run = flow.Claim()
            flow.Call([]string{"work", "--run", run})
            Check.That(listener.Pending(), "Verification had no network access")
            using let client = listener.AcceptTcpClient()
        } finally {
            listener.Stop()
        }
    }
}
