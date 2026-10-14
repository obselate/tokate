package TokateTests

import Gsharp.Concurrency
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Text.Json.Nodes

internal partial class CoordinationFlow : CoordinationFixture {
    shared {
        internal func Concurrent(binary string, path string, env Dictionary[string, string], output Chan[Result]) {
            output <- TestProcess.Run(binary, []string{"coordinate", "owner/project", "--event", path}, env)
        }

        internal func ProtectedCoordinator(binary string) {
            using let test = CoordinationFixture(binary)
            test.Initialize(approve: false)
            test.Flow.ProtectedPolicy()
            test.Flow.Approve()
            let claim = test.Claim()
            let comment = test.Comment
            using let baseline = FixtureSnapshot(test.Flow.Temp.Root)
            for change in[]string{
                "entrypoint",
                "rename-out",
                "rename-in",
                "directory-node",
                "mode",
                "type",
                "newline",
                "permitted"
            } {
                baseline.Restore()
                test.Comment = comment
                test.Flow.Reload()
                let commit = test.Candidate(claim, change)
                let publication = test.PublishRequest(claim, commit)
                if change == "permitted" {
                    test.Coordinate(test.Event(publication))
                    test.Flow.Call([]string{"verify", "owner/project#10"}, owner: true)
                } else {
                    Check.Contains(test.Coordinate(test.Event(publication), 1).Error, "protected owner path")
                    test.Flow.NoPr()
                    Check.That(test.State()["state"]?["contribution"] == nil, "Protected contribution gained authority")
                }
                test.Flow.NoInference()
            }
        }

        internal func CoordinatorPermissions(binary string) {
            using let test = CoordinationFixture(binary)
            test.Initialize()
            let initial = test.State()
            let request = test.ClaimRequest()
            let path = test.Event(request)
            using let baseline = FixtureSnapshot(test.Flow.Temp.Root)
            for permissions in[]string{"{}", "{\"push\":false}"} {
                for denied in[]bool{false, true} {
                    baseline.Restore()
                    test.Flow.Reload()
                    test.Flow.State["repo_permissions"] = Check.Json(permissions)
                    test.Flow.Save()
                    Check.Contains(
                        test.Flow.Call([]string{"approve", "owner/project#1"}, 1, owner: true).Error,
                        "Repository write permission is required"
                    )
                    if denied {
                        test.Flow.Temp.Env["GITHUB_ACTIONS"] = "true"
                        test.Flow.Faults(
                            "repos/owner/project/git/refs/heads/tokate/contributions/1",
                            Check.Json("[{\"status\":403}]")
                        )
                        let failure = test.Coordinate(path, 1)
                        Check.Contains(failure.Error, "No automatic retry was made")
                        Check.Contains(failure.Error, "::error::GitHub mutation failed (HTTP 403).")
                        Check.That(
                            failure.Error.Split("::error::").Length == 2,
                            "Coordinator emitted duplicate annotations"
                        )
                        test.Flow.Temp.Env.Remove("GITHUB_ACTIONS")
                        let state = test.State()
                        Check.That(
                            Check.Text(state["sha"]) == Check.Text(initial["sha"]) && state["state"]?.ToJsonString() ==
                            initial["state"]?.ToJsonString(),
                            "Denied state write changed authority or acquired a reservation"
                        )
                        test.Flow.Reload()
                        Check.That(Check.Text(test.Flow.State["fault_index"]) == "1", "Denied state write was retried")
                    } else {
                        test.Coordinate(path)
                        let state = test.State()
                        Check.That(
                            Check.Text(state["sha"]) != Check.Text(initial["sha"]) && Check.Text(
                                state["state"]?["reservation"]?["reservation"]
                            ) == Check.Text(request["uuid"]) && state["state"]?["outcomes"]?.AsArray().Count == 1,
                            "Claim did not record a reservation without push permission metadata"
                        )
                    }
                    test.Flow.NoInference()
                    test.Flow.NoPr()
                }
            }
            test.Flow.Temp.Env["GITHUB_ACTIONS"] = "true"
            Check.Contains(
                test.Flow.Call([]string{"admit", "owner/project", "--event", path}, 1, owner: true).Error,
                "::error::Expected a supported upstream pull_request_target event"
            )
            test.Flow.Temp.Env.Remove("GITHUB_ACTIONS")
            Check.That(
                !test
                    .Flow
                    .Call([]string{"admit", "owner/project", "--event", path}, 1, owner: true)
                    .Error
                    .Contains("::error::"),
                "Local failure emitted an Actions annotation"
            )
        }

        internal func ModelPolicyModes(binary string) {
            for mode in[]string{"whitelist", "unrestricted"} {
                using let test = CoordinationFlow(binary)
                test.Initialize(approve: false)
                test.Flow.SetModelPolicy(mode, mode == "unrestricted" ? "omit": "")
                let path = Path.Combine(test.Flow.Upstream, ".github/tokate.json")
                let policy = Check.Json(File.ReadAllText(path))
                if mode == "whitelist" {
                    let pairs = policy["allowed_tools"] ?? throw Exception("Missing allowed tools")
                    let codex = pairs[0] ?? throw Exception("Missing Codex tool")
                    let claude = pairs[1] ?? throw Exception("Missing Claude tool")
                    codex["models"] = Check.Json("{\"gpt-6.1-sol\":[\"high\",\"unknown\"]}")
                    claude["models"] = Check.Json("{\"claude-sonnet-4-6\":[\"high\",\"unknown\"]}")
                }

                if File.ReadAllText(path) != policy.ToJsonString() {
                    File.WriteAllText(path, policy.ToJsonString())
                    test.Flow.Commit("Owner selects per-tool models")
                }

                test.Flow.Approve()
                test.Claim()
                let original = Check.Json(File.ReadAllText(test.Tools))
                for index in 0 ... original.AsArray().Count {
                    let changed = original.DeepClone()
                    let tool = changed[index] ?? throw Exception("Missing declared tool")
                    for field in[]string{"model", "effort", "harness", "provider"} {
                        let value = tool[field]?.DeepClone()
                        tool[field] = JsonValue.Create(field == "effort" ? "invalid": "unlisted-value")
                        File.WriteAllText(test.Tools, changed.ToJsonString())
                        if mode == "unrestricted" && field == "model" {
                            continue
                        }
                        test.Prepare(code: 1)
                        tool[field] = value
                    }
                }
                if mode == "whitelist" {
                    for index in 0 ... original.AsArray().Count {
                        let changed = original.DeepClone()
                        let tool = changed[index] ?? throw Exception("Missing declared tool")
                        tool["model"] = original[1 - index]?["model"]?.DeepClone()
                        File.WriteAllText(test.Tools, changed.ToJsonString())
                        test.Prepare(code: 1)
                    }
                }

                File.WriteAllText(test.Tools, original.ToJsonString())
                let fork = Path.Combine(test.Flow.Bin, "fork")
                let branches = test.Flow.Git("-C", fork, "show-ref", "--heads")
                test.Prepare(code: 1, seconds: "3601")
                Check.That(
                    !Directory.Exists(Path.Combine(test.Flow.Temp.Root, "runs")),
                    "Forbidden budget created a saved run"
                )
                test.Flow.Reload()
                Check.That(
                    test.Flow.State["fork_creations"] == nil && test.Flow.Git(
                        "-C",
                        fork,
                        "show-ref",
                        "--heads"
                    ) == branches,
                    "Forbidden budget created a fork or changed a branch"
                )
                test.Prepare("tokate", 1)
                if mode == "unrestricted" {
                    let first = original[0] ?? throw Exception("Missing first tool")
                    let second = original[1] ?? throw Exception("Missing second tool")
                    first["model"] = JsonValue.Create("unlisted-claude-model")
                    second["model"] = JsonValue.Create("unlisted-codex-model")
                    File.WriteAllText(test.Tools, original.ToJsonString())
                }
                test.ExternalPublicationAfterClaim()
            }
        }

        internal func EffortDeclarations(binary string) {
            for mode in[]string{"", "whitelist", "unrestricted"} {
                using let test = CoordinationFlow(binary)
                test.Initialize(approve: false)
                test.Flow.SetModelPolicy(
                    mode,
                    mode == "unrestricted" ? "{}":
                    "{\"gpt-6.1-sol\":[\"high\",\"unknown\"],\"claude-sonnet-4-6\":[\"unknown\"]}"
                )
                test.Flow.Approve()
                test.Claim()
                let tool = Check.Json(
                    "[{\"harness\":\"codex\",\"provider\":\"openai\",\"model\":\"gpt-6.1-sol\",\"effort\":\"unknown\"}]"
                )
                let declaration = tool[0] ?? throw Exception("Missing tool")
                File.WriteAllText(test.Tools, tool.ToJsonString())
                test.Prepare("tokate", 1)
                let run = test.Prepare()
                let savedPath = Path.Combine(run, "run.json")
                let saved = File.ReadAllText(savedPath)
                Check.That(
                    Check.Text(Check.Json(saved)["tools"]?[0]?["effort"]) == "unknown",
                    "Legacy unknown was reinterpreted"
                )
                let changed = Check.Json(saved)
                changed["source"] = JsonValue.Create("tokate")
                changed["model"] = JsonValue.Create("gpt-6.1-sol")
                changed["effort"] = JsonValue.Create("unknown")
                File.WriteAllText(savedPath, changed.ToJsonString())
                test.Flow.Call([]string{"work", "--run", run}, 1)
                File.WriteAllText(savedPath, saved)
                for effort in[]string{"absent", "", "null", "invalid", "high,xhigh"} {
                    declaration["effort"] = effort == "null" ? nil: JsonValue.Create(effort)
                    if effort == "" {
                        declaration.AsObject().Remove("effort")
                    }
                    File.WriteAllText(test.Tools, tool.ToJsonString())
                    test.Prepare("tokate", 1)
                    if mode != "unrestricted" || effort != "absent" {
                        test.Prepare(code: 1)
                    }
                }
                test.Flow.NoInference()
                Check.That(File.ReadAllText(savedPath) == saved, "Rejected effort changed legacy saved work")
            }
            for mode in[]string{"whitelist", "unrestricted"} {
                using let test = CoordinationFlow(binary)
                test.Initialize(approve: false)
                test.Flow.SetModelPolicy(
                    mode,
                    mode == "unrestricted" ? "omit":
                    "{\"gpt-6.1-sol\":[\"absent\"],\"claude-sonnet-4-6\":[\"unknown\",\"absent\"]}"
                )
                test.Flow.Approve()
                test.Claim()
                let tools = Check.Json(File.ReadAllText(test.Tools))
                let declaration = tools[1] ?? throw Exception("Missing tool")
                declaration["effort"] = JsonValue.Create("absent")
                File.WriteAllText(test.Tools, tools.ToJsonString())
                test.ExternalPublicationAfterClaim()
            }
        }

        internal func ManagedModelPolicy(binary string) {
            for mode in[]string{"whitelist", "unrestricted"} {
                using let test = CoordinationFlow(binary)
                test.Initialize(approve: false)
                test.Flow.SetModelPolicy(
                    mode,
                    mode == "unrestricted" ? "{}":
                    "{\"gpt-6-sol\":[\"high\",\"unknown\",\"absent\"]}"
                )
                let policyPath = Path.Combine(test.Flow.Upstream, ".github/tokate.json")
                let policy = Check.Json(File.ReadAllText(policyPath))
                let models = policy["allowed_tools"]?[0]?["models"]?.DeepClone()
                policy["version"] = JsonValue.Create(3)
                policy.AsObject().Remove("models")
                policy.AsObject().Remove("model_policy")
                let codex = policy["allowed_tools"]?[0] ?? throw Exception("Missing Codex permission")
                let claude = policy["allowed_tools"]?[1] ?? throw Exception("Missing Claude permission")
                if mode == "whitelist" {
                    codex["models"] = models
                }

                claude["models"] = Check.Json("{\"gpt-6.1-sol\":[\"high\"]}")
                File.WriteAllText(policyPath, policy.ToJsonString())
                test.Flow.Commit("Owner sets managed per-tool model permissions")
                if mode == "whitelist" {
                    test.Flow.Reject(
                        []string{"select", "owner/project", "--model", "gpt-6.1-sol", "--effort", "high"},
                        "Model/effort pair"
                    )
                }

                test.Flow.Approve()
                test.Claim()
                let tools = Check.Json(
                    "[{\"harness\":\"codex\",\"provider\":\"openai\",\"model\":\"gpt-6-sol\",\"effort\":\"absent\"}]"
                )
                let declaration = tools[0] ?? throw Exception("Missing tool")
                File.WriteAllText(test.Tools, tools.ToJsonString())
                test.Prepare("tokate", 1)
                declaration["effort"] = JsonValue.Create("unknown")
                File.WriteAllText(test.Tools, tools.ToJsonString())
                test.Prepare("tokate", 1)
                declaration["effort"] = JsonValue.Create("high")
                File.WriteAllText(test.Tools, tools.ToJsonString())
                let run = test.Prepare("tokate")
                let path = Path.Combine(run, "run.json")
                let original = File.ReadAllText(path)
                let changed = Check.Json(original)
                changed["effort"] = JsonValue.Create("absent")
                let savedTool = changed["tools"]?[0] ?? throw Exception("Missing saved tool")
                savedTool["effort"] = JsonValue.Create("absent")
                File.WriteAllText(path, changed.ToJsonString())
                test.Flow.Call([]string{"work", "--run", run}, 1)
                test.Flow.NoInference()
                File.WriteAllText(path, original)
                test.Flow.Call([]string{"work", "--run", run})
                test.Flow.Call([]string{"submit", "--run", run})
                let request = Check.Json(File.ReadAllText(Path.Combine(run, "request.json")))
                let requestedTool = request["metadata"]?["tools"]?[0] ?? throw Exception("Missing requested tool")
                requestedTool["effort"] = JsonValue.Create("absent")
                test.Coordinate(test.Event(request), 1)
                test.Flow.NoPr()
                requestedTool["effort"] = JsonValue.Create("high")
                test.Coordinate(test.Event(request))
                test.Flow.Call([]string{"verify", "owner/project#10"}, owner: true)
                test.ReceiptRefusal(0, "effort", "absent")
                test.Flow.Reload()
                Check.That(
                    Check.Text(test.Flow.State["requested_model"]) == "gpt-6-sol" && Check.Text(
                        test.Flow.State["requested_effort"]
                    ) == "model_reasoning_effort=\"high\"",
                    "Managed declaration silently changed"
                )
            }
        }

        internal func ModelPolicyAuthority(binary string) {
            for mode in[]string{"whitelist", "unrestricted"} {
                using let test = CoordinationFixture(binary)
                test.Initialize()
                test.Claim()
                let run = test.Prepare()
                let path = Path.Combine(run, "run.json")
                let saved = File.ReadAllText(path)
                let original = test.State()
                if mode == "whitelist" {
                    using let baseline = FixtureSnapshot(test.Flow.Temp.Root)
                    let policyPath = Path.Combine(test.Flow.Upstream, ".github/tokate.json")
                    for field in[]string{
                        "verification",
                        "protected_paths",
                        "required_checks",
                        "max_seconds",
                        "allow_unlimited",
                        "reservation_seconds",
                        "legacy_digest"
                    } {
                        baseline.Restore()
                        if field == "legacy_digest" {
                            let state = test.State()["state"] ?? throw Exception("Missing state")
                            let approval = state["approval"] ?? throw Exception("Missing approval")
                            approval["policy_hash"] = JsonValue.Create(Check.Hash(policyPath))
                            state["approval_id"] = JsonValue.Create(Check.FixtureDigest(approval))
                            test.RewriteState(state)
                        } else {
                            let policy = Check.Json(File.ReadAllText(policyPath))
                            policy[field] = Check.Json(
                                switch field {
                                    case "verification": "[[\"bash\",\"scripts/verify.sh\"]]"
                                    case "protected_paths": "[\"owner-files/\"]"
                                    case "required_checks": "[\"new-check\"]"
                                    case "max_seconds": "3601"
                                    case "allow_unlimited": "true"
                                    default: "300"
                                }
                            )
                            File.WriteAllText(policyPath, policy.ToJsonString())
                            test.Flow.Commit("Owner changes task field " + field)
                        }
                        let status = Check.Envelope(
                            test.Flow.Call([]string{"status", "owner/project#1", "--json"}),
                            "status",
                            "ok"
                        )
                        let work = status["data"]?["work"]?[0] ?? throw Exception("Missing task status")
                        Check.That(
                            Check.Text(work["approval_status"]) == "stale",
                            "Task field change retained approval"
                        )
                        Check.Contains(
                            Check.Text(work["approval_reason"]),
                            "Approval no longer matches current task fields."
                        )
                        Check.Contains(
                            Check.Text(work["approval_reason"]),
                            field == "legacy_digest" ? "legacy approval digest": "Changed task fields: " + field + "."
                        )
                        Check.That(
                            work["next"]?["command"]?.ToJsonString() == "[\"tokate\",\"approve\",\"owner/project#1\"]",
                            "Stale approval status omitted the owner command"
                        )
                        Check.Contains(
                            test.Flow.Call([]string{"status", "owner/project#1", "--plain"}).Output,
                            "tokate approve owner/project#1"
                        )
                        Check.Contains(
                            test.Flow.Call([]string{"external", "--run", run, "--commit", String('0', 40)}, 1).Error,
                            field == "legacy_digest" ? "Saved run has stale coordination authority": "Approval no longer matches current task fields."
                        )
                        Check.That(File.ReadAllText(path) == saved, "Stale task fields rewrote the saved run")
                        test.Flow.NoInference()
                        test.Flow.NoPr()
                    }
                    baseline.Restore()
                    test.Flow.SetModelPolicy("whitelist")
                    let equivalent = Check.Envelope(
                        test.Flow.Call([]string{"status", "owner/project#1", "--json"}),
                        "status",
                        "ok"
                    )
                    Check.That(
                        Check.Text(equivalent["data"]?["work"]?[0]?["approval_status"]) == "current",
                        "Explicit default model mode changed the task digest"
                    )
                }
                test.Flow.SetModelPolicy(mode, mode == "unrestricted" ? "omit": "{\"gpt-6.1-sol\":[\"high\"]}")
                Check.Contains(
                    test.Flow.Call([]string{"external", "--run", run, "--commit", String('0', 40)}, 1).Error,
                    "Repository policy or template changed. The owner must approve again."
                )
                Check.That(
                    Check.Text(test.State()["sha"]) == Check.Text(original["sha"]),
                    "Mode change rewrote existing approval or reservation"
                )
                test.Flow.Approve()
                Check.That(File.ReadAllText(path) == saved, "Fresh approval converted saved work")
                test.Flow.Call([]string{"external", "--run", run, "--commit", String('0', 40)}, 1)
                test.Flow.NoInference()
                test.Flow.NoPr()
            }
        }
    }

    internal init(binary string) : base(binary) { }

    internal func ReplayAndInterruptedState() {
        let request = ClaimRequest()
        let path = Event(request)
        Flow.Mode("lost_state_response")
        Coordinate(path, 1)
        let state = State()
        Check.That(
            Check.Text(state["state"]?["reservation"]?["reservation"]) == Check.Text(request["uuid"]),
            "Lost response lost authoritative claim"
        )
        Flow.ResetTraffic()
        let replay = Coordinate(path, traffic: true)
        Flow.Traffic(12, 0, 0, replay)
        Check.That(Check.Text(State()["sha"]) == Check.Text(state["sha"]), "Replay wrote state")
        let changed = request.DeepClone()
        changed["metadata"] = Check.Map("command", "touch /tmp/unsafe")
        Coordinate(Event(changed), 1)
        Coordinate(Event(request, 124, "other"), 1)
        let parents = Flow.Git("-C", Flow.Upstream, "rev-list", "--parents", "-n", "1", Check.Text(state["sha"]))
        Check.That(parents.Split(' ').Length == 2, "State update did not have exactly one parent")
        Flow.NoInference()
        Flow.NoPr()
    }

    internal func ClaimRendezvous(first JsonNode, second JsonNode, timeout int32 = 10000) string {
        Check.That(Check.Text(first["expected"]) == Check.Text(second["expected"]), "Claims must share expected state")
        let directory = Path.Combine(Flow.Temp.Root, "claim-rendezvous-" + Guid.NewGuid().ToString("N"))
        Directory.CreateDirectory(directory)
        File.WriteAllText(
            Path.Combine(Flow.Bin, "claim-rendezvous.json"),
            Check.Map(
                "directory",
                directory,
                "expected",
                Check.Text(first["expected"]),
                "first",
                Check.Text(first["uuid"]),
                "second",
                Check.Text(second["uuid"]),
                "timeout_ms",
                timeout
            )
                .ToJsonString()
        )
        return directory
    }

    internal func ClearRendezvous(directory string) {
        File.Delete(Path.Combine(Flow.Bin, "claim-rendezvous.json"))
        Directory.Delete(directory, true)
    }

    internal func SimultaneousClaimsMissingParticipant() {
        let first = ClaimRequest()
        let second = ClaimRequest()
        let path = Event(first)
        let directory = ClaimRendezvous(first, second, 1000)
        try {
            let result = Coordinate(path, 1)
            Check.Contains(result.Error, "GitHub mutation failed")
            let failure = File.ReadAllText(Path.Combine(directory, Check.Text(first["uuid"]) + ".failed"))
            Check.Contains(failure, "Claim rendezvous timed out: " + Check.Text(first["uuid"]))
            Check.Contains(failure, "missing " + Check.Text(second["uuid"]) + ".arrived")
            Check.That(
                File.Exists(Path.Combine(directory, Check.Text(first["uuid"]) + ".arrived")),
                "Claim never arrived"
            )
            Check.That(
                !File.Exists(Path.Combine(directory, Check.Text(second["uuid"]) + ".arrived")),
                "Absent claim arrived"
            )
            Check.That(Check.Text(State()["sha"]) == Check.Text(first["expected"]), "Timed-out claim changed authority")
            Flow.Reload()
            for call in Flow.State["api_calls"]?.AsArray() ?? throw Exception("Missing API evidence") {
                Check.That(
                    Check.Text(call["method"]) != "PATCH" || Check.Text(call["path"]) !=
                    "repos/owner/project/git/refs/heads/tokate/contributions/1",
                    "Timed-out rendezvous reached the shared API-state lock"
                )
            }
        } finally {
            ClearRendezvous(directory)
        }
        Check.That(!Directory.Exists(directory), "Timed-out rendezvous markers were not cleaned up")
        Claim()
        Flow.NoInference()
    }

    internal func SimultaneousClaims() {
        let first = ClaimRequest()
        let second = ClaimRequest()
        let path1 = Event(first)
        let path2 = Event(second)
        let env = Dictionary[string, string](Flow.Temp.Env)
        env["GH_TOKEN"] = "fixture-owner"
        let output = Chan[Result](2)
        let directory = ClaimRendezvous(first, second)
        var a Result
        var b Result
        try {
            go Concurrent(Flow.Binary, path1, env, output)
            go Concurrent(Flow.Binary, path2, env, output)
            a = <-output
            b = <-output
            for request in[]JsonNode{first, second} {
                let failure = Path.Combine(directory, Check.Text(request["uuid"]) + ".failed")
                if File.Exists(failure) {
                    throw Exception(File.ReadAllText(failure))
                }
                Check.That(
                    File.Exists(Path.Combine(directory, Check.Text(request["uuid"]) + ".arrived")),
                    "Claim did not reach rendezvous: " + Check.Text(request["uuid"]) + "\n" + a.Error + b.Error
                )
            }
        } finally {
            ClearRendezvous(directory)
        }
        Check.That(
            (a.Code == 0 && b.Code == 1) || (a.Code == 1 && b.Code == 0),
            "Competing command claims did not produce exactly one winner: " + a.Error + b.Error
        )
        let state = State()
        Check.That(state["state"]?["outcomes"]?.AsArray().Count == 1, "Two outcomes acquired authority")
        Flow.Reload()
        var attempts int32
        var rejected int32
        for call in Flow.State["api_calls"]?.AsArray() ?? throw Exception("Missing API evidence") {
            if Check.Text(call["method"]) == "PATCH" && Check.Text(
                call["path"]
            ) == "repos/owner/project/git/refs/heads/tokate/contributions/1" {
                attempts++
                if Check.Text(call["status"]) == "422" {
                    rejected++
                }
            }
        }
        Check.That(
            attempts == 2 && rejected == 1,
            "Concurrent claims did not exercise the non-forced competing ref updates: PATCH attempts=" +
                attempts.ToString() + ", 422 rejections=" + rejected.ToString()
        )
        Coordinate(Event(ClaimRequest(), 124, "other"), 1)
        Flow.NoInference()
    }

    internal func ProtectedExternal() {
        Flow.ProtectedPolicy()
        Flow.Approve()
        let claim = Claim()
        let run = Prepare()
        let commit = Candidate(claim, "entrypoint")
        Check.Contains(
            Flow.Call([]string{"external", "--run", run, "--commit", commit}, 1).Error,
            "protected owner path"
        )
        Check.That(
            File.ReadAllText(Path.Combine(run, "checkout/scripts/verify.sh")) == "exit 0\n",
            "External work lost"
        )
        Check.That(!File.Exists(Path.Combine(run, "verification.json")), "External replaced verifier ran")
        let saved = Check.Json(File.ReadAllText(Path.Combine(run, "run.json")))
        Check.That(
            Check.Text(saved["commit"]) == commit && Check.Text(saved["state"]) == "failed",
            "External failure lost its exact commit"
        )
        Check.Contains(Check.Text(saved["error"]), "protected owner path")
        Flow.Call([]string{"submit", "--run", run}, 1)
        Flow.NoPr()
        Flow.NoInference()
    }

    internal func ProtectedManaged() {
        Flow.ProtectedPolicy()
        Flow.Approve()
        Claim()
        File.WriteAllText(
            Tools,
            "[{\"harness\":\"codex\",\"provider\":\"openai\",\"model\":\"gpt-6.1-sol\",\"effort\":\"high\"}]"
        )
        let run = Prepare("tokate")
        Flow.Mode("protected_entrypoint")
        Check.Contains(Flow.Call([]string{"work", "--run", run}, 1).Error, "protected owner path")
        Check.That(File.Exists(Path.Combine(run, "checkout/scripts/verify.sh")), "Rejected verifier edit was discarded")
        Check.That(!File.Exists(Path.Combine(run, "verification.json")), "Protected verifier was executed")
        Flow.Call([]string{"submit", "--run", run}, 1)
        Flow.NoPr()
    }

    internal func ReceiptEvidence() {
        Flow.ProtectedPolicy()
        Flow.Approve()
        let claim = Claim()
        Candidate(claim, "permitted")
        let history = Path.Combine(Flow.Temp.Root, "donor-work")
        for i in 0 ... 250 {
            Flow.DonorGit(history, "commit", "--allow-empty", "--quiet", "-m", "History " + i.ToString())
        }
        let historyHead = Flow.Git("-C", history, "rev-parse", "HEAD")
        Flow.Git(
            "-C",
            history,
            "push",
            Path.Combine(Flow.Bin, "fork"),
            "HEAD:refs/heads/tokate/v2-" + Check.Text(claim["uuid"])
        )
        Coordinate(Event(PublishRequest(claim, historyHead)))
        Flow.MetadataOnly()
        for fault in[]string{
            "missing-files",
            "truncated-files",
            "wrong-base",
            "wrong-head",
            "missing-previous",
            "missing-status",
            "missing-commits"
        } {
            Flow.DiffFault("diff_fault", fault)
            Flow.Call([]string{"verify", "owner/project#10"}, 1, owner: true)
        }
        Flow.DiffFault("diff_fault", "")
        Flow.Call([]string{"verify", "owner/project#10"}, owner: true)
        let checkout = Path.Combine(Flow.Temp.Root, "donor-work")
        let marker = Path.Combine(checkout, "receipt-code-ran")
        File.WriteAllText(Path.Combine(checkout, "scripts/verify.sh"), "touch '" + marker + "'\nexit 0\n")
        Flow.Git("-C", checkout, "add", "-A")
        Flow.Git(
            "-C",
            checkout,
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.test",
            "commit",
            "-m",
            "Forged success"
        )
        let head = Flow.Git("-C", checkout, "rev-parse", "HEAD")
        Flow.Git(
            "-C",
            checkout,
            "push",
            Path.Combine(Flow.Bin, "fork"),
            "HEAD:refs/heads/tokate/v2-" + Check.Text(claim["uuid"])
        )
        let state = State()
        let value = state["state"] ?? throw Exception("Missing state")
        let contribution = value["contribution"] ?? throw Exception("Missing contribution")
        let metadata = contribution["metadata"] ?? throw Exception("Missing metadata")
        let expected = Check.Text(contribution["expected"])
        contribution["expected"] = JsonValue.Create(Check.Text(state["sha"]))
        metadata["head"] = JsonValue.Create(head)
        let outcome = contribution["outcome"] ?? throw Exception("Missing contribution outcome")
        outcome["head"] = JsonValue.Create(head)
        RewriteState(value)
        Flow.Reload()
        let pull = Flow.State["pulls"]?[0] ?? throw Exception("Missing PR")
        let prHead = pull["head"] ?? throw Exception("Missing PR head")
        prHead["sha"] = JsonValue.Create(head)
        pull["body"] = JsonValue.Create(
            Check
                .Text(pull["body"])
                .Replace(historyHead, head, StringComparison.Ordinal)
                .Replace(expected, Check.Text(state["sha"]), StringComparison.Ordinal)
        )
        Flow.Save()
        Check.Contains(Flow.Call([]string{"verify", "owner/project#10"}, 1, owner: true).Error, "protected owner path")
        Flow.NoInference()
        Check.That(!File.Exists(marker), "Read-only validation executed PR code")
    }

    internal func InterruptedVerification() {
        Flow.VerificationPolicy(
            "mkdir build-output; printf generated > build-output/data; printf synthetic-prior-check",
            second: "test -s build-output/data; printf 'synthetic-%s-prefix' external; printf 'synthetic-%s-error' external >&2; if test \"$$(cat result.txt)\" = failed; then exit 7; fi; sleep 3"
        )
        Flow.Approve()
        let claim = Claim()
        let run = Prepare(seconds: "1")
        let commit = Candidate(claim)
        let summary = Path.Combine(Flow.Temp.Root, "summary.json")
        File.WriteAllText(
            summary,
            Check.Map(
                "head",
                commit,
                "changes",
                Check.Json("[\"Add an external result.\"]"),
                "verification",
                Check.Json("[]"),
                "limitations",
                Check.Json("[]")
            )
                .ToJsonString()
        )
        let failure = Flow.Call(
            []string{"external", "--run", run, "--commit", commit, "--summary", summary, "--json"},
            1
        )
        Check.That(!(failure.Output + failure.Error).Contains("synthetic-external"), "Raw external output escaped")
        Check.That(
            Check.Text(Check.Json(failure.Output)["error"]?["code"]) == "verification_failed",
            "External interruption lost its structured failure classification"
        )
        let savedPath = Path.Combine(run, "run.json")
        let saved = Check.Json(File.ReadAllText(savedPath))
        Check.That(Check.Text(saved["state"]) == "failed", "External timeout lost failed state")
        Check.That(Check.Text(saved["failure_stage"]) == "owner_verification", "External phase lost")
        Check.That(saved["verification"]?.AsArray().Count == 2, "External prior or active checks lost")
        Check.That(Check.Text(saved["verification"]?[0]?["exit_code"]) == "0", "External prior check lost")
        Check.That(saved["verification"]?[1]?["exit_code"] == nil, "External interruption fabricated exit code")
        Check.Contains(Check.Text(saved["verification"]?[1]?["output"]), "synthetic-external-prefix")
        Check.Contains(Check.Text(saved["verification"]?[1]?["error"]), "synthetic-external-error")
        let evidence = File.ReadAllText(savedPath)
        Flow.Call([]string{"submit", "--run", run}, 1)
        Flow.Call([]string{"external", "--run", run, "--commit", commit}, 1)
        Check.That(File.ReadAllText(savedPath) == evidence, "Interrupted external verification retried")
        Check.That(
            Flow.Git("-C", Path.Combine(run, "checkout"), "rev-parse", "HEAD") == commit,
            "External candidate lost"
        )
        Check.That(
            !Directory.Exists(Path.Combine(run, "checkout/build-output")),
            "Interrupted external build output retained"
        )
        Flow.NoPr()
        Flow.NoInference()
        let work = Path.Combine(Flow.Temp.Root, "donor-work")
        File.WriteAllText(Path.Combine(work, "result.txt"), "failed\n")
        Flow.Git("-C", work, "add", "result.txt")
        Flow.DonorGit(work, "commit", "-m", "External correction")
        let second = Flow.Git("-C", work, "rev-parse", "HEAD")
        let branch = "HEAD:refs/heads/tokate/v2-" + Check.Text(claim["uuid"])
        Flow.Git("-C", work, "push", Path.Combine(Flow.Bin, "fork"), branch)
        let tools = Check.Json(File.ReadAllText(Tools)).AsArray()
        tools.Add(
            Check.Json(
                "{\"provider\":\"openai\",\"harness\":\"codex\",\"model\":\"gpt-6.1-sol\",\"effort\":\"high\",\"usage\":null,\"coding_seconds\":null}"
            )
        )
        File.WriteAllText(Tools, tools.ToJsonString())
        let retry = []string{"external", "--run", run, "--commit", second, "--time", "30s", "--tools", Tools}
        let verificationPath = Path.Combine(run, "verification.json")
        let recorded = File.ReadAllText(verificationPath)
        let history = Path.Combine(run, "external-history", commit)
        using let baseline = FixtureSnapshot(Flow.Temp.Root)
        for mutation in[]string{"all-pass", "command", "mismatch"} {
            baseline.Restore()
            let changed = Check.Json(evidence)
            let check = changed["verification"]?[1] ?? throw Exception("Missing failed check")
            switch mutation {
                case "all-pass" {
                    check["state"] = JsonValue.Create("completed")
                    check["exit_code"] = JsonValue.Create(0)
                }
                case "command" {
                    check["command"] = Check.Json("[\"/bin/true\"]")
                }
                case "mismatch" {
                    check["failure"] = JsonValue.Create("different")
                }
            }
            File.WriteAllText(savedPath, changed.ToJsonString())
            if mutation != "mismatch" {
                File.WriteAllText(verificationPath, changed["verification"]?.ToJsonString())
            }
            let before = File.ReadAllText(savedPath)
            Flow.Call(retry, 1)
            Check.That(
                File.ReadAllText(savedPath) == before && !Directory.Exists(history),
                "Invalid failure started correction"
            )
        }
        baseline.Restore()
        let journal = Path.Combine(run, "request.json.posting.json")
        File.CreateSymbolicLink(journal, summary)
        Flow.Call(retry, 1)
        Check.That(File.ReadAllText(savedPath) == evidence, "Publication journal replaced failed evidence")
        File.Delete(journal)
        File.Delete(verificationPath)
        File.CreateSymbolicLink(verificationPath, summary)
        Flow.Call(retry, 1)
        Check.That(!Directory.Exists(history), "Linked verification record started correction")
        baseline.Restore()
        for missing in[]string{"seconds", "tools"} {
            let args = List[string]{"external", "--run", run, "--commit", second}
            args.AddRange(missing == "seconds" ? []string{"--tools", Tools}: []string{"--time", "30s"})
            Flow.Call(args.ToArray(), 1)
        }
        File.WriteAllText(Tools, "[]")
        Flow.Call(retry, 1)
        Check.That(File.ReadAllText(savedPath) == evidence, "Missing declarations or budget replaced failed evidence")
        baseline.Restore()
        Directory.CreateDirectory(history + ".tmp")
        Flow.Call(retry, 1)
        Check.That(File.ReadAllText(savedPath) == evidence, "Partial capture was silently repaired")
        baseline.Restore()
        let between = Check.Json(evidence)
        between["verification"]?.AsArray().RemoveAt(1)
        between["error"] = JsonValue.Create("Verification budget exhausted")
        File.WriteAllText(savedPath, between.ToJsonString())
        File.WriteAllText(verificationPath, between["verification"]?.ToJsonString())
        Flow.Call(retry, 1)
        Check.That(Directory.Exists(history), "Between-command deadline could not be corrected")
        baseline.Restore()
        Flow.Call(retry, 1)
        let archived = Path.Combine(history, "original-evidence")
        Check.That(File.ReadAllText(Path.Combine(archived, "run.json")) == evidence, "Original failed run changed")
        Check.That(File.ReadAllText(Path.Combine(archived, "verification.json")) == recorded, "Original checks changed")
        for check in saved["verification"]?.AsArray() ?? throw Exception("Missing original checks") {
            for field in[]string{"output_file", "error_file"} {
                let path = Check.Text(check[field])
                Check.That(
                    File.ReadAllText(Path.Combine(archived, path)) == File.ReadAllText(Path.Combine(run, path)),
                    "Original output changed"
                )
            }
        }
        Check.That(
            Flow.Git("-C", Path.Combine(history, "checkout"), "rev-parse", "HEAD") == commit,
            "Original checkout lost"
        )
        let failedAgain = Check.Json(File.ReadAllText(savedPath))
        Check.That(
            Check.Text(failedAgain["verification"]?[1]?["exit_code"]) == "7",
            "New failure lost actual exit code"
        )
        Check.That(
            Check.Text(failedAgain["seconds"]) == "1" && Check.Text(failedAgain["verification_seconds"]) == "30",
            "Correction overwrote original budget"
        )
        Check.That(
            failedAgain["public_summary"] == nil && failedAgain["verification_provenance"] == nil,
            "Correction reused old provenance"
        )
        Check.That(
            failedAgain["tools"]?.ToJsonString() == tools.ToJsonString(),
            "Correction lost cumulative tool declarations"
        )
        File.WriteAllText(Path.Combine(work, "result.txt"), "corrected\n")
        Flow.Git("-C", work, "add", "result.txt")
        Flow.DonorGit(work, "commit", "-m", "Correct external result")
        let final = Flow.Git("-C", work, "rev-parse", "HEAD")
        Flow.Git("-C", work, "push", Path.Combine(Flow.Bin, "fork"), branch)
        let finalArgs = []string{"external", "--run", run, "--commit", final, "--time", "30s", "--tools", Tools}
        let unchanged = File.ReadAllText(savedPath)
        Check.Contains(Flow.Call(finalArgs, 1).Error, "must append at least one tool declaration")
        Check.That(File.ReadAllText(savedPath) == unchanged, "Equal tool count replaced failed evidence")
        tools.Add(tools[2]?.DeepClone())
        File.WriteAllText(Tools, tools.ToJsonString())
        for head in[]string{commit, second} {
            Flow.Call([]string{"external", "--run", run, "--commit", head, "--time", "30s", "--tools", Tools}, 1)
        }
        using let failedBaseline = FixtureSnapshot(Flow.Temp.Root)
        for missing in[]bool{false, true} {
            failedBaseline.Restore()
            if missing {
                Directory.Delete(history, true)
            } else {
                File.AppendAllText(Path.Combine(archived, "run.json"), " ")
            }
            let before = File.ReadAllText(savedPath)
            Flow.Call(finalArgs, 1)
            Flow.Call([]string{"submit", "--run", run}, 1)
            Check.That(File.ReadAllText(savedPath) == before, "Damaged history was silently repaired")
            Flow.NoPr()
        }
        failedBaseline.Restore()
        Flow.Call(finalArgs)
        let completed = Check.Json(File.ReadAllText(savedPath))
        Check.That(
            Check.Text(completed["state"]) == "generated" && Check.Text(completed["commit"]) == final,
            "New external head did not verify"
        )
        Check.That(
            completed["public_summary"] == nil && completed["failure_stage"] == nil,
            "Successful correction kept stale evidence"
        )
        Check.That(
            Check.Text(completed["tools"]?[0]?["effort"]) == "unknown" &&
                completed["tools"]?[0]?["usage"] == nil &&
                completed["tools"]?[0]?["coding_seconds"] == nil,
            "Unknown original attribution changed"
        )
        Flow.NoPr()
        Flow.Call([]string{"submit", "--run", run})
        Flow.Reload()
        let request = Check.PostedRequest(Flow.State)
        Check.That(Check.Text(request["metadata"]?["head"]) == final, "Submission reused failed head")
        Check.That(
            Check.Text(request["metadata"]?["source"]) == "external" && request["metadata"]?["correction"] == nil,
            "External correction changed publication protocol"
        )
        Coordinate(Event(request))
        Flow.Call([]string{"verify", "owner/project#10"}, owner: true)
        Flow.NoInference()
    }

    internal func ExternalPublication() {
        let claim = Claim()
        let reserved = State().ToJsonString()
        for json in[]bool{false, true} {
            let args = List[string]{"approve", "owner/project#1"}
            if json {
                args.Add("--json")
            }
            let refused = Flow.Call(args.ToArray(), 1, owner: true)
            Check.Contains(refused.Output + refused.Error, "active reservation")
            Check.Contains(refused.Output + refused.Error, "--yes")
            Check.That(State().ToJsonString() == reserved, "Unconfirmed approval changed the reservation")
        }
        let run = Prepare()
        let commit = Candidate(claim)
        File.Delete(Path.Combine(Flow.Bin, "codex"))
        Flow.Call([]string{"external", "--run", run, "--commit", String('0', 40)}, 1)
        Flow.Call([]string{"external", "--run", run, "--commit", commit})
        let saved = Check.Json(File.ReadAllText(Path.Combine(run, "run.json")))
        Check.Contains(Check.Text(saved["verification_provenance"]), "tokate-observed")
        Check.Contains(Check.Text(saved["tool_provenance"]), "donor-reported")
        Check.That(
            Flow.Git("-C", Path.Combine(run, "checkout"), "rev-parse", "HEAD") == commit,
            "Wrong external commit verified"
        )
        Check.That(
            !File.Exists(Path.Combine(run, "checkout/.git/objects/info/alternates")),
            "Imported external Git metadata"
        )
        Flow.CommitIdentity(Path.Combine(run, "checkout"), commit, "Donor", "donor@example.test")
        Flow.Call([]string{"submit", "--run", run})
        Flow.Reload()
        let publish = Check.PostedRequest(Flow.State)
        let path = Event(publish)
        Flow.Mode("pr_fail_after_create")
        Coordinate(path, 1)
        Flow.Mode("")
        Flow.ResetTraffic()
        let result = Coordinate(path, traffic: true)
        Flow.Traffic(58, 3, 0, result)
        Flow.Reload()
        Check.That(Flow.State["pulls"]?.AsArray().Count == 1, "Interrupted publication duplicated PR")
        Check.That(
            Check.Text(State()["state"]?["contribution"]?["metadata"]?["head"]) == commit,
            "State lost exact commit"
        )
        Flow.ResetTraffic()
        let duplicate = Coordinate(path, traffic: true)
        Flow.Traffic(12, 0, 0, duplicate)
        Flow.Call([]string{"verify", "owner/project#10"}, owner: true)
        Flow.Call([]string{"checks", "owner/project#10"}, 8, owner: true)
        Expire()
        Flow.Call([]string{"verify", "owner/project#10"}, 1, owner: true)
        Flow.Call([]string{"submit", "--run", run}, 1)
        Flow.NoInference()
        let published = State().ToJsonString()
        for json in[]bool{false, true} {
            let args = List[string]{"approve", "owner/project#1"}
            if json {
                args.Add("--json")
            }
            let refused = Flow.Call(args.ToArray(), 1, owner: true)
            Check.Contains(refused.Output + refused.Error, "published PR owner/project#10")
            Check.Contains(refused.Output + refused.Error, "--yes")
            Check.That(State().ToJsonString() == published, "Unconfirmed approval changed published authority")
        }
        Flow.Call([]string{"coordination", "owner/project#1"}, owner: true)
        Flow.Temp.Env["GH_TOKEN"] = "fixture-owner"
        let machine = TestTerminal.Pty(
            Flow.Binary,
            []string{"approve", "owner/project#1", "--json"},
            Flow.Temp,
            80,
            "y\n"
        )
        Check.That(machine.Code == 1, machine.Output + machine.Error)
        Check.Contains(machine.Output, "published PR owner/project#10")
        Check.That(State().ToJsonString() == published, "JSON approval accepted terminal confirmation")
        Flow.Call([]string{"coordination", "owner/project#1"}, owner: true)
        let declined = TestTerminal.Pty(
            Flow.Binary,
            []string{"approve", "owner/project#1", "--base-branch", "main"},
            Flow.Temp,
            80,
            "\n"
        )
        Check.That(declined.Code == 1, declined.Output + declined.Error)
        Check.Contains(declined.Output, "published PR owner/project#10")
        Check.Contains(declined.Output, "Re-approve")
        Check.That(State().ToJsonString() == published, "Declined approval changed published authority")
        Flow.Call([]string{"coordination", "owner/project#1"}, owner: true)
        let confirmed = TestTerminal.Pty(
            Flow.Binary,
            []string{"approve", "owner/project#1", "--base-branch", "main", "--yes"},
            Flow.Temp,
            80,
            ""
        )
        Check.Success(confirmed)
        Check.Contains(confirmed.Output, "published PR owner/project#10")
        Check.That(State()["state"]?["contribution"] == nil, "Confirmed approval retained the old contribution")
        Claim()
        Flow.Call([]string{"approve", "owner/project#1", "--json", "--yes"}, owner: true)
        let renewed = State()
        Check.That(
            renewed["state"]?["reservation"] == nil && renewed["state"]?["identity"] == nil,
            "Explicit confirmation retained the old reservation authority"
        )
    }

    internal func CanonicalExternal() {
        let claim = Claim()
        let run = Prepare()
        let benign = Candidate(claim)
        let work = Path.Combine(Flow.Temp.Root, "donor-work")
        File.AppendAllText(Path.Combine(work, ".github/tokate-pr.md"), "\nhidden protected change\n")
        Flow.Git("-C", work, "add", ".")
        Flow.Git(
            "-C",
            work,
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=test@example.test",
            "commit",
            "-m",
            "Protected correction"
        )
        let malicious = Flow.Git("-C", work, "rev-parse", "HEAD")
        Flow.Git(
            "-C",
            work,
            "push",
            Path.Combine(Flow.Bin, "fork"),
            malicious + ":refs/heads/tokate/v2-" + Check.Text(claim["uuid"])
        )
        Flow.Reload()
        Flow.State["replacement_for"] = JsonValue.Create(malicious)
        Flow.State["replacement_with"] = JsonValue.Create(benign)
        Flow.Save()
        Flow.Mode("external_replacement")
        let failure = Flow.Call([]string{"external", "--run", run, "--commit", malicious}, 1)
        Check.Contains(failure.Error, "protected owner configuration")
        Check.That(!File.Exists(Path.Combine(run, "verification.json")), "Hidden protected change was verified")
        Check.That(
            !File.Exists(Path.Combine(run, "request.json")),
            "Hidden protected change obtained publication authority"
        )
        Flow.NoPr()
        Flow.NoInference()
    }

    internal func CanonicalSubmit() {
        let claim = Claim()
        let run = Prepare()
        let commit = Candidate(claim)
        Flow.Call([]string{"external", "--run", run, "--commit", commit})
        let checkout = Path.Combine(run, "checkout")
        let savedPath = Path.Combine(run, "run.json")
        let saved = File.ReadAllText(savedPath)
        using let baseline = FixtureSnapshot(Flow.Temp.Root)
        File.AppendAllText(Path.Combine(checkout, "result.txt"), "Dirty checkout\n")
        let rejected = Check.Envelope(
            Flow.Call([]string{"submit", "--run", run, "--json"}, 1),
            "submit",
            "error",
            "invalid_state"
        )
        Check.That(
            Check.Text(rejected["error"]?["message"]) == "Verified checkout changed",
            "JSON submission lost the exact checkout reason"
        )
        Check.That(!File.Exists(Path.Combine(run, "request.json")), "Dirty checkout obtained publication authority")
        Check.That(File.ReadAllText(savedPath) == saved, "Dirty checkout rejection rewrote verification record")
        baseline.Restore()
        Flow.Git("-C", checkout, "checkout", "--detach", Check.Text(Check.Json(saved)["base"]))
        File.WriteAllText(Path.Combine(checkout, "result.txt"), "External mixed-tool contribution\n")
        File.AppendAllText(Path.Combine(checkout, ".github/tokate-pr.md"), "\nhidden protected change\n")
        Flow.Git("-C", checkout, "add", ".")
        Flow.DonorGit(checkout, "commit", "-m", "Packed replacement attack")
        let malicious = Flow.Git("-C", checkout, "rev-parse", "HEAD")
        Flow.Git("-C", checkout, "replace", malicious, commit)
        Flow.Git("-C", checkout, "pack-refs", "--all", "--prune")
        Flow.Git("--no-replace-objects", "-C", checkout, "checkout", "--force", "--detach", malicious)
        let changed = Check.Json(saved)
        changed["commit"] = JsonValue.Create(malicious)
        File.WriteAllText(savedPath, changed.ToJsonString())
        Flow.Call([]string{"submit", "--run", run}, 1)
        Check.That(!File.Exists(Path.Combine(run, "request.json")), "Packed replacement obtained publication authority")
        Flow.NoPr()
        Flow.NoInference()
        baseline.Restore()
        for flag in[]string{"--assume-unchanged", "--skip-worktree"} {
            Flow.Git("-C", checkout, "update-index", flag, ".github/tokate-pr.md")
            File.AppendAllText(Path.Combine(checkout, ".github/tokate-pr.md"), "\nhidden work file\n")
            Check.That(Flow.Git("-C", checkout, "status", "--porcelain") == "", "Changed candidate must look clean")
            Check.Contains(Flow.Call([]string{"submit", "--run", run}, 1).Error, "Candidate index")
            Check.That(
                !File.Exists(Path.Combine(run, "request.json")),
                "Hidden work file obtained publication authority"
            )
            Check.That(File.ReadAllText(savedPath) == saved, "Blocked submit rewrote verification record")
            Flow.Git("-C", checkout, "update-index", "--no-assume-unchanged", ".github/tokate-pr.md")
            Flow.Git("-C", checkout, "update-index", "--no-skip-worktree", ".github/tokate-pr.md")
            Flow.Git("-C", checkout, "checkout", "--", ".github/tokate-pr.md")
        }
        Directory.CreateDirectory(Path.Combine(checkout, ".git/info"))
        File.WriteAllText(Path.Combine(checkout, ".git/info/grafts"), commit + "\n")
        Check.Contains(Flow.Call([]string{"submit", "--run", run}, 1).Error, "info/grafts")
        Check.That(!File.Exists(Path.Combine(run, "request.json")), "Grafted candidate obtained publication authority")
        Check.That(File.ReadAllText(savedPath) == saved, "Graft rejection rewrote verification record")
        Flow.NoPr()
        Flow.NoInference()
        baseline.Restore()
        let waiting = Check.Json(Flow.Call([]string{"submit", "--run", run, "--json"}).Output)
        Check.That(waiting["data"]?["coordinator"] == nil, "Absent workflow changed submit guidance")
        Check.Contains(
            Flow.Call([]string{"submit", "--run", run}).Output,
            "Submit pending. Run the same command again:"
        )
        for conclusion in[]string{"failure", "startup_failure", "queued"} {
            Flow.Reload()
            Flow.State["workflow_runs"] = JsonArray(
                Check.Map(
                    "created_at",
                    "2026-10-12T00:00:00Z",
                    "status",
                    conclusion,
                    "conclusion",
                    conclusion,
                    "check_suite_id",
                    20,
                    "html_url",
                    "https://example.test/coordinator"
                )
            )
            Flow.State["coordinator_checks"] = Check.Json("[{\"id\":30}]")
            Flow.State["coordinator_annotations"] = JsonArray(
                Check.Map(
                    "annotation_level",
                    "failure",
                    "message",
                    "GitHub mutation failed (HTTP 422). " + String('x', 1100)
                )
            )
            Flow.Save()
            let observed = Check.Json(Flow.Call([]string{"submit", "--run", run, "--json"}).Output)
            let action = Check.Text(observed["data"]?["next"]?["action"])
            Check.Contains(
                action,
                conclusion == "failure" ? "GitHub mutation failed (HTTP 422).":
                (conclusion == "startup_failure" ? "repository's Actions settings": "coordinator is still running")
            )
            Check.Contains(action, "https://example.test/coordinator")
            Check.That(!action.Contains(String('x', 1025)), "Failure annotation exceeded its bound")
            Check.That(
                !(observed["next_actions"]?.ToJsonString() ?? "").Contains("\"submit\""),
                "Pending workflow offered repeat submit"
            )
            let status = Check.Json(Flow.Call([]string{"status", "--run", run, "--json"}).Output)
            Check.That(
                Check.Text(status["data"]?["next"]?["action"]) == action,
                "Status lost pending publication reason"
            )
            if conclusion == "failure" {
                Check.Contains(Flow.Call([]string{"submit", "--run", run}).Output, "GitHub mutation failed (HTTP 422).")
            }
        }
        baseline.Restore()
        let submitted = Flow.Acquire([]string{"submit", "--run", run})
        Check.Contains(submitted.Output, "Draft PR: https://github.com/owner/project/pull/10")
        let published = Check.Json(File.ReadAllText(savedPath))
        Check.That(
            Check.Text(published["state"]) == "published" && Check.Text(published["pr"]) == "10",
            "Submit returned before adopting its coordinated publication"
        )
        Flow.Reload()
        Check.That(Check.Text(Flow.State["request_count"]) == "1", "Waiting submit posted more than once")
    }

    internal func ExpiryAndRevocation() {
        let original = Claim()
        let run = Prepare()
        Expire()
        Flow.Call([]string{"external", "--run", run, "--commit", String('0', 40)}, 1)
        let publication = PublishRequest(original, String('a', 40))
        Coordinate(Event(publication), 1)
        let late = ClaimRequest()
        Claim()
        Coordinate(Event(late), 1)
        Flow.Call([]string{"revoke", "owner/project#1"}, owner: true)
        Prepare(code: 1)
        Flow.NoInference()
        Flow.NoPr()
    }

    internal func InvalidEvents() {
        let request = ClaimRequest()
        let path = Event(request)
        let original = File.ReadAllText(path)
        var event = Check.Json(original)
        let user = event["comment"]?["user"] ?? throw Exception("Missing user")
        user["id"] = JsonValue.Create(124)
        File.WriteAllText(path, event.ToJsonString())
        Coordinate(path, 1)
        event = Check.Json(original)
        let comment = event["comment"] ?? throw Exception("Missing comment")
        comment["body"] = JsonValue.Create("/tokate {\"uuid\":1,\"uuid\":2}")
        Flow.Reload()
        let canonical = Flow.State["comments"]?[Comment.ToString()] ?? throw Exception("Missing canonical comment")
        canonical["body"] = comment["body"]?.DeepClone()
        Flow.Save()
        File.WriteAllText(path, event.ToJsonString())
        Coordinate(path, 1)
        for body in[]string{
            "/tokate " + request.ToJsonString() + " trailing",
            "/tokate " + String('[', 33) + "0" + String(']', 33),
            "/tokate {\"data\":\"" + String('x', 8192) + "\"}"
        } {
            comment["body"] = JsonValue.Create(body)
            Flow.Reload()
            let fresh = Flow.State["comments"]?[Comment.ToString()] ?? throw Exception("Missing comment")
            fresh["body"] = JsonValue.Create(body)
            Flow.Save()
            File.WriteAllText(path, event.ToJsonString())
            Coordinate(path, 1)
        }
        File.WriteAllText(path, String('x', 1024 * 1024 + 1))
        Coordinate(path, 1)
        for field in[]string{
            "actor",
            "command",
            "patch",
            "credentials",
            "expression",
            "accept",
            "assign",
            "",
            "uuid,expected"
        } {
            let prohibited = request.DeepClone()
            prohibited[field] = JsonValue.Create("untrusted synthetic value")
            Coordinate(Event(prohibited), 1)
        }
        Check.That(State()["state"]?["reservation"] == nil, "Invalid event changed authority")
        Flow.NoInference()
    }

    internal func InterruptedWrite() {
        let recovery = []string{"recover-request", "owner/project#1"}
        Check.Contains(Flow.Call(recovery, 1, owner: true).Error, "recorded requests cannot be recovered")
        Event(ClaimRequest())
        Flow.Reload()
        let comments = Flow.State["comments"] ?? throw Exception("Missing comments")
        for index in 0 ... 100 {
            Comment++
            comments[Comment.ToString()] = Check.Map("id", Comment, "body", "Ordinary issue comment")
        }
        Flow.Save()
        let request = ClaimRequest()
        let path = Event(request)
        Flow.Mode("interrupted_state_write")
        Flow.ResetTraffic()
        let failure = Coordinate(path, 1)
        Check.Contains(failure.Error, "One conditional ref retry was made")
        Check.Contains(failure.Error, "owner must update the coordinator, then re-process the request")
        Check.Contains(failure.Error, "donor runs the same saved command again")
        Flow.Reload()
        var attempts int32
        for call in Flow.State["api_calls"]?.AsArray() ?? throw Exception("Missing API evidence") {
            if Check.Text(call["method"]) == "PATCH" {
                attempts++
            }
        }
        Check.That(attempts == 2, "Failed ref update did not stop after one retry")
        Check.That(State()["state"]?["reservation"] == nil, "Interrupted write acquired a claim")
        Flow.Mode("")
        Check.Contains(Flow.Call(recovery, 1).Error, "Repository write permission is required")
        Flow.Reload()
        let changed = Check.Json(File.ReadAllText(path))["comment"] ?? throw Exception("Missing comment")
        changed["body"] = JsonValue.Create("/tokate {}")
        Flow.State["canonical_comment_override"] = changed.DeepClone()
        Flow.Save()
        Check.Contains(Flow.Call(recovery, 1, owner: true).Error, "identity changed")
        Check.That(State()["state"]?["reservation"] == nil, "Refused recovery acquired a claim")
        Flow.Reload()
        Flow.State.AsObject().Remove("canonical_comment_override")
        Flow.Save()
        Flow.Faults("repos/owner/project/git/refs/heads/tokate/contributions/1", Check.Json("[{\"status\":500}]"))
        Flow.Temp.Env.Remove("GITHUB_EVENT_NAME")
        let recovered = Flow.Call([]string{"recover-request", "owner/project#1", "--json"}, owner: true)
        Check.That(
            Check.Text(Check.Json(recovered.Output)["data"]?["reservation"]) == Check.Text(request["uuid"]),
            "Recovery did not return the latest request outcome"
        )
        Flow.Temp.Env["GITHUB_EVENT_NAME"] = "issue_comment"
        Flow.Reload()
        attempts = 0
        var inspected bool
        for call in Flow.State["api_calls"]?.AsArray() ?? throw Exception("Missing API evidence") {
            if Check.Text(call["method"]) == "GET" && Check.Text(call["path"]) ==
            "repos/owner/project/git/ref/heads/tokate/contributions/1" && attempts == 1 {
                inspected = true
            }
            if Check.Text(call["method"]) == "PATCH" {
                attempts++
                Check.That(attempts == 1 || inspected, "Ref retry did not re-read current state")
            }
        }
        Check.That(attempts == 2, "Transient ref failure did not retry once")
        Check.That(
            Check.Text(State()["state"]?["reservation"]?["reservation"]) == Check.Text(request["uuid"]),
            "Transient ref retry did not acquire the exact claim"
        )
        let revision = Check.Text(State()["sha"])
        Coordinate(path)
        Check.That(Check.Text(State()["sha"]) == revision, "Interrupted-write replay repeated its effect")
        Check.Contains(Flow.Call(recovery, 1, owner: true).Error, "Stale state or approval")
        Flow.Reload()
        Flow.State["comments"] = Check.Map(Comment.ToString(), Check.Json(File.ReadAllText(path))["comment"])
        Flow.Save()
        Event(request)
        Flow.ResetTraffic()
        Check.Contains(Flow.Call(recovery, 1, owner: true).Error, "recorded requests cannot be recovered")
        Flow.Reload()
        for call in Flow.State["api_calls"]?.AsArray() ?? throw Exception("Missing API evidence") {
            Check.That(Check.Text(call["method"]) == "GET", "Recorded recovery repeated a write")
        }
        Check.That(Check.Text(State()["sha"]) == revision, "Recovery changed a recorded request")
        Flow.NoInference()
        Flow.NoPr()
    }

    internal func PublicationRevocation() {
        let claim = Claim()
        let run = Prepare()
        let commit = Candidate(claim)
        Flow.Call([]string{"external", "--run", run, "--commit", commit})
        Flow.Call([]string{"submit", "--run", run})
        let request = Check.Json(File.ReadAllText(Path.Combine(run, "request.json")))
        Flow.Mode("revoke_after_pr")
        Coordinate(Event(request), 1)
        Flow.Reload()
        Check.That(Flow.State["pulls"]?.AsArray().Count == 1, "Race should retain physical PR for owner inspection")
        Check.That(State()["state"]?["contribution"] == nil, "Revoked PR received authority")
        Flow.Call([]string{"verify", "owner/project#10"}, 1, owner: true)
        Flow.NoInference()
    }

    internal func ExpiryDuringPublication() {
        let claim = Claim()
        let run = Prepare()
        let commit = Candidate(claim)
        Flow.Call([]string{"external", "--run", run, "--commit", commit})
        Flow.Call([]string{"submit", "--run", run})
        let state = State()["state"] ?? throw Exception("Missing state")
        let reservation = state["reservation"] ?? throw Exception("Missing reservation")
        reservation["expires"] = JsonValue.Create(DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 2)
        RewriteState(state)
        let request = Check.Json(File.ReadAllText(Path.Combine(run, "request.json")))
        request["expected"] = JsonValue.Create(Check.Text(State()["sha"]))
        Coordinate(Event(request), 1)
        Check.That(State()["state"]?["contribution"] == nil, "Paced publication acquired expired authority")
        Flow.NoInference()
    }

    internal func EvictedReplay() {
        var first JsonNode? = nil
        for i in 0 ... 33 {
            let request = ClaimRequest()
            if i == 0 {
                first = request.DeepClone()
            }
            Coordinate(Event(request))
            if i < 32 {
                Expire()
            }
        }
        let current = State()
        Check.That(current["state"]?["outcomes"]?.AsArray().Count == 32, "Outcome window is not bounded at 32")
        Coordinate(Event(first ?? throw Exception("Missing first request")), 1)
        Check.That(Check.Text(State()["sha"]) == Check.Text(current["sha"]), "Evicted request repeated a claim")
        Flow.NoInference()
    }

    internal func SetupRelease() {
        let output = Path.Combine(Flow.Temp.Root, "coordinator.yml")
        let args = []string{"coordinator-setup", "owner/project", "--output", output, "--yes"}
        Flow.Call(args, 1, owner: true)
        Check.That(!File.Exists(output), "Unreleased binary generated a workflow")
        Flow.Call(
            []string{
                "coordinator-setup",
                "owner/project",
                "--output",
                Path.Combine(Flow.Upstream, ".github/coordinator.yml")
            },
            1,
            owner: true
        )
        Flow.Reload()
        Flow.State["actions_policy"] = Check.Map(
            "enforcement",
            "active",
            "rules",
            Check.Json(
                "[{\"type\":\"restrict_action_events\",\"parameters\":{\"allowed_events\":[\"issue_comment\",\"pull_request_target\",\"workflow_call\"]}}]"
            )
        )
        Flow.Save()
        Check.Contains(Flow.Call(args, 1, owner: true).Error, "must allow issues")
        Check.That(!File.Exists(output), "Old event policy generated a workflow")
        Flow.Reload()
        Flow.State["actions_policy"] = nil
        Flow.Save()
        Flow.ReleaseReady(hosted: false)
        Check.Contains(Flow.Call(args, 1, owner: true).Error, "Bootstrap required")
        Check.That(!File.Exists(output), "Bootstrap failure wrote an unusable workflow")
        Flow.Reload()
        Flow.State["hosted_workflow"] = JsonValue.Create(true)
        Flow.State["release_tag"] = Check.Map("object", Check.Map("type", "tag", "sha", String('b', 40)))
        Flow.Save()
        let version = Flow.Call([]string{"--version"}).Output.Trim().Substring(7)
        let bundle = "tokate-" + version + "-linux-x64"
        let archive = Path.Combine(Flow.Bin, "release.tar.gz")
        Flow.ResetTraffic()
        let initial = Flow.Call(args, owner: true, traffic: true)
        Flow.Traffic(10, 0, 0, initial)
        Check.That(!initial.Error.Contains("Compare shared workflows:"), "New setup reported a current pin")
        let yaml = File.ReadAllText(output)
        Check.Contains(yaml, "issues:\n    types: [labeled]\n")
        Check.Contains(yaml, "issues: write\n")
        Check.Contains(yaml, "https://api.github.com/repos/obselate/tokate/releases/assets/41")
        Check.Contains(yaml, Check.Hash(archive))
        Check.Contains(yaml, bundle + "/tokate")
        Check.Contains(yaml, "uses: obselate/tokate/.github/workflows/tokate-shared.yml@" + String('a', 40))
        Check.That(!yaml.Contains("run:") && yaml.Split('\n').Length < 25, "Adopter received copied runtime code")
        Check.That(
            !yaml.Contains("@ARCHIVE") && !yaml.Contains("actions/checkout"),
            "Generated workflow contains unresolved pins or repository checkout"
        )
        Flow.Call(args, 1, owner: true)
        File.Delete(output)
        let workflow = Path.Combine(Flow.Upstream, ".github/workflows/tokate-coordinator.yml")
        Directory.CreateDirectory(Path.GetDirectoryName(workflow) ?? "")
        let oldCommit = String('c', 40)
        let newCommit = String('a', 40)
        let current = yaml.Replace(bundle, "tokate-0.3.5-linux-x64").Replace(newCommit, oldCommit)
        File.WriteAllText(workflow, current)
        Flow.Commit("Install old coordinator pin")
        let compareUrl = "https://github.com/obselate/tokate/compare/" + oldCommit + "..." + newCommit
        let releaseUrl = "https://github.com/obselate/tokate/releases/tag/v" + version
        let shared = "obselate/tokate/.github/workflows/tokate-shared.yml@"
        let unrelated = "actions/checkout@*"
        let selected = Check.Map(
            "github_owned_allowed",
            true,
            "verified_allowed",
            false,
            "patterns_allowed",
            JsonArray(JsonValue.Create(unrelated), JsonValue.Create(shared + oldCommit))
        )
        Flow.Reload()
        Flow.State["actions_permissions"] = Check.Map("enabled", true, "allowed_actions", "selected")
        Flow.State["selected_actions"] = selected.DeepClone()
        Flow.State["allowlist_setup"] = JsonValue.Create(true)
        Flow.Save()
        Flow.ResetTraffic()
        let preview = Flow.Call(
            []string{"coordinator-setup", "owner/project", "--output", output, "--non-interactive"},
            owner: true,
            traffic: true
        )
        Flow.Traffic(9, 0, 0, preview)
        Check.Contains(preview.Error, "Current Tokate version: 0.3.5, shared workflow commit: " + oldCommit)
        Check.Contains(preview.Error, "New Tokate version: " + version + ", shared workflow commit: " + newCommit)
        Check.Contains(preview.Error, "Compare shared workflows: " + compareUrl)
        Check.Contains(preview.Error, "New release: " + releaseUrl)
        Check.That(
            preview.Error.IndexOf("New release:") < preview.Error.IndexOf("Proposed complete file:"),
            "Pin review followed the file preview"
        )
        Check.That(!File.Exists(output), "Review preview wrote a workflow")
        Flow.Reload()
        Check.That(
            Flow.State["selected_actions"]?.ToJsonString() == selected.ToJsonString(),
            "Preview changed the allowlist"
        )
        Flow.ResetTraffic()
        let json = Flow.Call(
            []string{"coordinator-setup", "owner/project", "--output", output, "--yes", "--json"},
            owner: true,
            traffic: true
        )
        Flow.Traffic(11, 1, 0, json)
        let data = Check.Json(json.Output)["data"] ?? throw Exception("Missing setup data")
        Check.That(Check.Text(data["current_version"]) == "0.3.5", "JSON lost the current version")
        Check.That(Check.Text(data["new_version"]) == version, "JSON lost the new version")
        Check.That(Check.Text(data["current_commit"]) == oldCommit, "JSON lost the current commit")
        Check.That(Check.Text(data["new_commit"]) == newCommit, "JSON lost the new commit")
        Check.That(Check.Text(data["compare_url"]) == compareUrl, "JSON lost the workflow comparison")
        Check.That(Check.Text(data["release_url"]) == releaseUrl, "JSON lost the release link")
        Check.Contains(Check.Text(data["actions_allowlist"]), "Updated the Actions allowlist")
        let updated = selected.DeepClone()
        updated["patterns_allowed"]?.AsArray().Add(JsonValue.Create(shared + newCommit) as JsonNode)
        Check.That(
            Flow.State["selected_actions"]?.ToJsonString() == updated.ToJsonString(),
            "Setup failed to preserve existing entries and add the new workflow entry"
        )
        Check.That(File.ReadAllText(output) == yaml, "Review changed the proposed workflow")
        Check.That(File.ReadAllText(workflow) == current, "Setup updated the installed pin")
        for mode in[]string{"denied", "wildcard", "blocked", "missing"} {
            File.Delete(output)
            let settings = selected.DeepClone()
            if mode == "wildcard" || mode == "blocked" {
                settings["patterns_allowed"] = JsonArray(JsonValue.Create(unrelated), JsonValue.Create(shared + "*"))
                if mode == "blocked" {
                    settings["patterns_allowed"]?.AsArray().Add(JsonValue.Create("!" + shared + "*") as JsonNode)
                }
            } else if mode == "missing" {
                settings["patterns_allowed"] = JsonArray(JsonValue.Create(unrelated))
            }
            Flow.Reload()
            Flow.State["selected_actions"] = settings.DeepClone()
            Flow.State["allowlist_write_denied"] = JsonValue.Create(mode == "denied")
            Flow.Save()
            Flow.ResetTraffic()
            let result = Flow.Call(args, owner: true, traffic: true)
            Flow.Traffic(11, mode == "denied" || mode == "missing" ? 1: 0, 0, result)
            Check.That(File.ReadAllText(output) == yaml, "Allowlist handling lost the pinned workflow")
            if mode == "missing" {
                settings["patterns_allowed"]?.AsArray().Add(JsonValue.Create(shared + newCommit) as JsonNode)
                Check.Contains(result.Output, "Updated the Actions allowlist")
            } else if mode == "denied" || mode == "blocked" {
                Check.Contains(result.Output, "Settings > Actions > General > Actions permissions")
                Check.Contains(result.Output, "add " + shared + newCommit)
                Check.Contains(
                    result.Output,
                    mode == "denied" ? "Could not update": "Remove the blocking exclusion !" + shared + "*"
                )
            } else {
                Check.Contains(result.Output, "Actions permits " + shared + newCommit)
            }
            Check.That(
                Flow.State["selected_actions"]?.ToJsonString() == settings.ToJsonString(),
                "Setup changed unrelated Actions permissions"
            )
        }
        File.Delete(output)
        File.WriteAllText(workflow, current.Replace(oldCommit, "main"))
        Flow.Commit("Install malformed coordinator pin")
        Check.Contains(Flow.Call(args, 1, owner: true).Error, "missing or malformed")
        Check.That(!File.Exists(output), "Malformed current pin generated a workflow")
    }

    internal func TokateExecution() {
        Claim()
        File.WriteAllText(
            Tools,
            "[{\"harness\":\"codex\",\"provider\":\"openai\",\"model\":\"gpt-6.1-sol\",\"effort\":\"high\"}]"
        )
        let run = Prepare("tokate")
        Flow.Call([]string{"work", "--run", run})
        using let baseline = FixtureSnapshot(Flow.Temp.Root)
        let comment = Comment
        Flow.Call([]string{"amend", "--run", run})
        let policyPath = Path.Combine(Flow.Upstream, ".github/tokate.json")
        let policy = Check.Json(File.ReadAllText(policyPath))
        policy["close_message"] = JsonValue.Create("Updated owner message")
        policy["eligibility"] = JsonValue.Create("open")
        File.WriteAllText(policyPath, policy.ToJsonString())
        Flow.Commit("Owner changes descriptive text and eligibility after evidence capture")
        Flow.Call([]string{"access", "untrust", "donor", "owner/project"}, owner: true)
        Flow.Call([]string{"amend", "--run", run})
        let corrected = AmendmentFlow.Correct(Flow, run)
        AmendmentFlow.Rework(Flow, run, corrected, tools: Tools)
        Flow.Call([]string{"submit", "--run", run})
        Coordinate(Event(Check.Json(File.ReadAllText(Path.Combine(run, "request.json")))))
        Flow.Call([]string{"verify", "owner/project#10"}, owner: true)
        baseline.Restore()
        Comment = comment
        Flow.Call([]string{"submit", "--run", run})
        let request = Check.Json(File.ReadAllText(Path.Combine(run, "request.json")))
        Flow.CommitIdentity(
            Path.Combine(Flow.Bin, "fork"),
            Check.Text(request["metadata"]?["head"]),
            "donor",
            "tokate@users.noreply.github.com"
        )
        let path = Event(request)
        Flow.ResetTraffic()
        let result = Coordinate(path, traffic: true)
        Flow.Traffic(61, 4, 0, result)
        Flow.Call([]string{"submit", "--run", run})
        let published = File.ReadAllText(Path.Combine(run, "run.json"))
        let saved = Check.Json(published)
        Check.That(
            Check.Text(saved["state"]) == "published" && Check.Text(saved["pr"]) == "10",
            "Submit did not adopt the coordinated publication"
        )
        Flow.Call([]string{"checks", "--run", run}, 8)
        Flow.Call([]string{"submit", "--run", run})
        Check.That(
            File.ReadAllText(Path.Combine(run, "run.json")) == published,
            "Repeated submit rewrote published metadata"
        )
        Flow.Call([]string{"verify", "owner/project#10"}, owner: true)
        Flow.Reload()
        Check.That(Check.Text(Flow.State["exec_count"]) == "1", "Tokate path did not execute exactly once")
    }

    internal func DeclarationRestrictions() {
        Claim()
        Prepare("tokate", 1)
        let declarations = Check.Json(File.ReadAllText(Tools))
        let tool = declarations[1] ?? throw Exception("Missing mixed tool")
        tool["model"] = JsonValue.Create("disallowed-model")
        File.WriteAllText(Tools, declarations.ToJsonString())
        Prepare(code: 1)
        File.WriteAllText(
            Tools,
            "[{\"harness\":\"codex\",\"provider\":\"openai\",\"model\":\"gpt-6.1-sol\",\"effort\":\"high\"}]"
        )
        let run = Prepare("tokate")
        let path = Path.Combine(run, "run.json")
        let saved = Check.Json(File.ReadAllText(path))
        saved["model"] = JsonValue.Create("disallowed-model")
        File.WriteAllText(path, saved.ToJsonString())
        Check.Contains(Flow.Call([]string{"work", "--run", run}, 1).Error, "no model substitution")
        Flow.NoInference()
    }

    internal func ExternalPublicationAfterClaim() {
        let state = State()
        let reservation = Check.Text(state["state"]?["reservation"]?["reservation"])
        let claim = Check.Map("uuid", reservation)
        let run = Prepare()
        let commit = Candidate(claim)
        Flow.Call([]string{"external", "--run", run, "--commit", commit})
        Flow.Call([]string{"submit", "--run", run})
        let request = Check.Json(File.ReadAllText(Path.Combine(run, "request.json")))
        let metadata = request["metadata"] ?? throw Exception("Missing publication metadata")
        let declared = metadata["tools"]?.DeepClone() ?? throw Exception("Missing declared tools")
        let policyPath = Path.Combine(Flow.Upstream, ".github/tokate.json")
        let ownerPolicy = Check.Json(File.ReadAllText(policyPath))
        let unrestricted = ownerPolicy["allowed_tools"]?[0]?["models"] == nil
        for index in 0 ... declared.AsArray().Count {
            let tools = declared.DeepClone()
            let tool = tools[index] ?? throw Exception("Missing declared tool")
            tool[unrestricted ? "effort": "model"] = JsonValue.Create(unrestricted ? "invalid": "disallowed-model")
            metadata["tools"] = tools
            Coordinate(Event(request), 1)
            Flow.NoPr()
        }
        if !unrestricted {
            for index in 0 ... declared.AsArray().Count {
                let tools = declared.DeepClone()
                let tool = tools[index] ?? throw Exception("Missing declared tool")
                tool["model"] = declared[1 - index]?["model"]?.DeepClone()
                metadata["tools"] = tools
                Check.Contains(Coordinate(Event(request), 1).Error, "Model/effort pair")
                Flow.NoPr()
            }
        }

        metadata["tools"] = declared.DeepClone()
        let source = Check.Text(metadata["source"])
        metadata["source"] = JsonValue.Create("tokate")
        Coordinate(Event(request), 1)
        Flow.NoPr()
        metadata["source"] = JsonValue.Create(source)
        Coordinate(Event(request))
        Flow.Call([]string{"verify", "owner/project#10"}, owner: true)
        for index in 0 ... declared.AsArray().Count {
            ReceiptRefusal(index, unrestricted ? "effort": "model", unrestricted ? "invalid": "disallowed-model")
        }
        if !unrestricted {
            for index in 0 ... declared.AsArray().Count {
                ReceiptRefusal(index, "model", Check.Text(declared[1 - index]?["model"]))
            }
        }

        let published = State()
        let saved = File.ReadAllText(Path.Combine(run, "run.json"))
        Flow.Reload()
        let pulls = Flow.State["pulls"]?.ToJsonString() ?? ""
        let pair = ownerPolicy["allowed_tools"]?[0] ?? throw Exception("Missing allowed tool")
        if unrestricted {
            pair["models"] = Check.Json("{\"gpt-6.1-sol\":[\"high\"]}")
        } else {
            pair.AsObject().Remove("models")
        }

        File.WriteAllText(policyPath, ownerPolicy.ToJsonString())
        Flow.Commit("Owner changes tool models")

        Check.Contains(
            Flow.Call([]string{"submit", "--run", run}, 1).Error,
            "Repository policy or template changed. The owner must approve again."
        )
        Check.Contains(
            Flow.Call([]string{"verify", "owner/project#10"}, 1, true).Error,
            "Repository policy or template changed. The owner must approve again."
        )
        Check.That(
            Check.Text(State()["sha"]) == Check.Text(published["sha"]),
            "Policy edit rewrote coordination authority"
        )
        Flow.Reload()
        Check.That(
            File.ReadAllText(Path.Combine(run, "run.json")) == saved && Flow.State["pulls"]?.ToJsonString() == pulls,
            "Policy edit rewrote saved contribution or receipt"
        )
        Flow.NoInference()
    }

    internal func ReceiptRefusal(index int32, field string, value string) {
        let original = State()
        let previous = Check.Text(original["sha"])
        let state = original["state"] ?? throw Exception("Missing state")
        let contribution = state["contribution"] ?? throw Exception("Missing contribution")
        let declaration = contribution["metadata"]?["tools"]?[index] ?? throw Exception("Missing receipt tool")
        declaration[field] = JsonValue.Create(value)
        contribution["expected"] = JsonValue.Create(previous)
        RewriteState(state)
        let forged = Check.Text(State()["sha"])
        Flow.Reload()
        let pull = Flow.State["pulls"]?[0] ?? throw Exception("Missing PR")
        let body = Check.Text(pull["body"])
        let prefix = "<!-- tokate-receipt:"
        let start = body.IndexOf(prefix, StringComparison.Ordinal) + prefix.Length
        let end = body.IndexOf(" -->", start, StringComparison.Ordinal)
        let receipt = Check.Json(body.Substring(start, end - start))
        receipt["expected"] = JsonValue.Create(previous)
        pull["body"] = JsonValue.Create(body.Substring(0, start) + receipt.ToJsonString() + body.Substring(end))
        Flow.Save()
        let failure = Flow.Call([]string{"verify", "owner/project#10"}, 1, true)
        Check.That(
            failure.Error.Contains("Model/effort pair") || failure.Error.Contains("reasoning effort") ||
                failure
                .Error
                .Contains("supported effort control"),
            "Receipt did not reach shared declaration validation: " + failure.Error
        )
        Flow.Git("-C", Flow.Upstream, "update-ref", "refs/heads/tokate/contributions/1", previous, forged)
        Flow.Reload()
        let restored = Flow.State["pulls"]?[0] ?? throw Exception("Missing PR")
        restored["body"] = JsonValue.Create(body)
        Flow.Save()
    }

    private func Donating(args[]string, env Dictionary[string, string], output Chan[Result]) {
        output <- TestProcess.Run(Flow.Binary, args, env)
    }

    internal func RepositoryDonation() {
        let start = []string{"work", "owner/project", "--json"}
        let stop = []string{"work", "owner/project", "stop", "--yes", "--json"}
        let missing = Check.Envelope(Flow.Call(start, 1), "work", "error", "invalid_arguments")
        Check.Contains(Check.Text(missing["error"]?["message"]), "tokate defaults set NAME --harness codex")
        Check.Contains(Check.Text(missing["error"]?["message"]), "tokate work OWNER/REPO --harness")
        Flow.Call([]string{"defaults", "set", "donor", "--model", "gpt-6.1-sol", "--effort", "high"})
        Flow.Call([]string{"defaults", "use", "donor"})
        Check.Envelope(Flow.Call(start, 1), "work", "error", "confirmation_required")
        Flow.Git("-C", Flow.Upstream, "remote", "add", "origin", "https://github.com/owner/project")
        let total = []string{"work", "--total", "1s", "--yes", "--json"}
        let exhaustedRun = TestProcess.Run(Flow.Binary, total, Flow.Temp.Env, cwd: Flow.Upstream)
        let exhausted = Check.Envelope(exhaustedRun, "work", "ok")
        Check.That(Check.Text(exhausted["data"]?["reason"]) == "total_exhausted", "Donation exceeded its total budget")
        Flow.NoInference()
        let stateDir = Path.Combine(Flow.Temp.Env["HOME"], ".local/state/tokate/donations/owner/project")
        let marker = Path.Combine(stateDir, "stop")
        File.WriteAllText(marker, "stale")
        Coordinate(Event(ClaimRequest(), actor: 1, login: "owner"))
        let reserved = Flow.Git("-C", Flow.Upstream, "rev-parse", "tokate/contributions/1")
        Flow.Reload()
        let second = Flow.State["issue"]?.DeepClone() ?? throw Exception("Missing issue")
        second["number"] = JsonValue.Create(2)
        Flow.State["issues"] = Check.Map("1", Flow.State["issue"]?.DeepClone(), "2", second)
        Flow.State["event_stream"] = JsonValue.Create(
            "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"Fixture completed.\"}}\n{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":100,\"cached_input_tokens\":20,\"output_tokens\":10}}\n"
        )
        Flow.Save()
        Flow.Call([]string{"approve", "owner/project#2"}, owner: true)
        let args = []string{"work", "owner/project", "--time", "30s", "--yes", "--json"}
        let tokens = Check.Json("{\"input_tokens\":100,\"cached_input_tokens\":20,\"output_tokens\":10}")
        let env = Dictionary[string, string](Flow.Temp.Env)
        env["GH_TOKEN"] = "fixture-donor"
        let output = Chan[Result](1)
        go Donating(args, env, output)
        let deadline = DateTime.UtcNow.AddSeconds(110)
        var handled int32
        var result Result? = nil
        while result == nil {
            Flow.Reload()
            let comments = Flow.State["request_comments"]?.AsArray() ?? JsonArray()
            if comments.Count > handled {
                let comment = comments[handled] ?? throw Exception("Missing donation request")
                Check.That(Check.Text(comment["issue_url"]).EndsWith("/2"), "Donation claimed the reserved issue")
                let posted = Check.PostedRequest(Check.Map("posted_request", comment.DeepClone()))
                Flow.CoordinatePosted(2)
                handled++
                if Check.Text(posted["action"]) == "publish" {
                    let other = []string{"work", "other/project", "stop", "--yes", "--json"}
                    Check.Envelope(Flow.Call(other), "work", "ok")
                    let report = Check.Envelope(Flow.Call(stop), "work", "ok")["data"]
                    Check.That(Check.Text(report?["submitted"]) == "1", "Stop did not wait for the task report")
                    Check.That(JsonNode.DeepEquals(report?["usage"], tokens), "Stop lost task usage")
                }
            }
            select {
                case let finished = <- output {
                    result = finished
                }
                case <- after(TimeSpan.FromMilliseconds(20)) { }
            }
            Check.That(DateTime.UtcNow < deadline, "Donation did not stop")
        }
        let summary = Check.Envelope(result ?? throw Exception("Missing donation result"), "work", "ok")["data"] ??
            throw Exception("Missing donation summary")
        Check.That(handled == 2, "Donation did not claim and submit exactly one task")
        Check.That(Check.Text(summary["submitted"]) == "1" && Check.Text(summary["failed"]) == "0", "Task failed")
        Check.That(Check.Text(summary["skipped"]) == "1", "Donation did not count the reserved issue as skipped")
        Check.That(Check.Text(summary["reason"]) == "stopped", "Donation ignored the stop marker")
        let task = summary["tasks"]?[1] ?? throw Exception("Missing task")
        Check.That(Check.Text(task["issue"]) == "2", "Donation reported the wrong issue")
        Check.Contains(Check.Text(task["pr_url"]), "/pull/10")
        let last = Check.Envelope(Flow.Call(stop), "work", "ok")["data"]
        Check.That(JsonNode.DeepEquals(summary, last), "Stopped session report changed")
        Check.That(!File.Exists(marker), "Stop marker was not removed")
        let current = Flow.Git("-C", Flow.Upstream, "rev-parse", "tokate/contributions/1")
        Check.That(current == reserved, "Reservation changed")
        Flow.Reload()
        Check.That(Check.Text(Flow.State["exec_count"]) == "1", "Donation repeated inference")
        let pulls = Flow.State["pulls"]?.AsArray() ?? JsonArray()
        Check.That(pulls.Count == 1 && Check.Text(pulls[0]?["draft"]) == "true", "Missing draft PR")
    }
}
