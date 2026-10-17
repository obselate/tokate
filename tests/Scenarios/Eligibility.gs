package TokateTests

import System
import System.Collections.Generic
import System.IO
import System.Text.Json.Nodes

internal class EligibilityChecks {
    shared {
        private func Access(
            test CoordinationFixture,
            operation string,
            donor string = "donor",
            issue string = "",
            code int32 = 0,
            owner bool = true,
            traffic bool = false
        ) Result {
            let args = List[string]{"access", "--yes", operation}
            if operation == "init" {
                args.Add("owner/project")
            } else if operation == "check" || operation == "request" {
                if issue != "" {
                    args.Add("owner/project#" + issue)
                }
            } else {
                args.Add(donor)
                args.Add(issue == "" ? "owner/project": "owner/project#" + issue)
            }
            return test.Flow.Call(args.ToArray(), code, owner, traffic)
        }

        private func Policy(test CoordinationFixture, mode string, version int32 = 0) {
            let path = Path.Combine(test.Flow.Upstream, ".github/tokate.json")
            let policy = Check.Json(File.ReadAllText(path))
            policy["approval_scope"] = JsonValue.Create("task")
            policy["eligibility"] = JsonValue.Create(mode)
            if version != 0 {
                policy["version"] = JsonValue.Create(version)
            }
            let text = policy.ToJsonString()
            if File.ReadAllText(path) != text {
                File.WriteAllText(path, text)
                test.Flow.Commit("Owner task eligibility " + mode)
            }
        }

        private func Setup(test CoordinationFixture, mode string, version int32 = 0) {
            Access(test, "init")
            Policy(test, mode, version)
            test.Flow.Call([]string{"approve", "--yes", "owner/project#1"}, owner: true)
            File.WriteAllText(
                test.Tools,
                "[{\"harness\":\"codex\",\"provider\":\"openai\",\"model\":\"gpt-6.1-sol\",\"effort\":\"high\"}]"
            )
            let approval = test.State()["state"]?["approval"] ?? throw Exception("Missing approval")
            Check.That(
                approval["donor"] == nil && Check.Text(approval["repo_id"]) == "1",
                "Task approval assigned a donor or lacks numeric identity"
            )
            test.Flow.Reload()
            let issue = test.Flow.State["issue"] ?? throw Exception("Missing issue")
            issue["assignees"] = JsonArray()
            test.Flow.Save()
        }

        private func Claim(test CoordinationFixture, code int32 = 0, actor int32 = 123) JsonNode {
            let request = test.ClaimRequest()
            test.Coordinate(test.Event(request, actor), code)
            return request
        }

        private func Modes(binary string) {
            for configuration in[]string{"3 open", "3 trusted"} {
                let parts = configuration.Split(' ')
                let version = Int32.Parse(parts[0])
                let mode = parts[1]
                using let test = CoordinationFixture(binary)
                test.Initialize(approve: false)
                Setup(test, mode, version)
                test.Flow.Git("-C", test.Flow.Upstream, "update-ref", "-d", "refs/heads/tokate/access")
                let state = test.State()["state"] ?? throw Exception("Missing state")
                let approval = state["approval"] ?? throw Exception("Missing approval")
                Check.That(
                    Check.Text(approval["eligibility"]) == mode,
                    "Approval did not use the current eligibility semantics"
                )
                let initial = Access(test, "check", issue: "1", code: mode == "open" ? 0: 1, owner: false)
                if mode != "open" {
                    Check.Contains(
                        initial.Error,
                        "Eligibility mode: trusted. Missing donor trust and issue approval access."
                    )
                    Check.Contains(initial.Error, "The owner must run: tokate approve owner/project#1 donor")
                    Check.Contains(initial.Error, "tokate access trust donor owner/project")
                    for command in[]string{"claim", "work"} {
                        Check.Contains(
                            test.Flow.Call([]string{command, "--yes", "owner/project#1", "--time", "1s"}, 1).Error,
                            "The owner must run: tokate approve owner/project#1 donor"
                        )
                    }
                    Claim(test, 1)
                }
                Access(test, "trust")
                Access(test, "check", issue: "1", owner: false)
                using let trusted = FixtureSnapshot(test.Flow.Temp.Root)
                Claim(test)
                trusted.Restore()
                Access(test, "untrust")
                test.Flow.Call([]string{"approve", "--yes", "owner/project#1", "other"}, owner: true)
                Access(test, "check", issue: "1", code: mode == "open" ? 0: 1, owner: false)
                test.Flow.Call([]string{"approve", "--yes", "owner/project#1", "donor"}, owner: true)
                let bound = test.State()["state"] ?? throw Exception("Missing approval state")
                Check.That(
                    Check.Text(bound["approval"]?["allowed_actor_ids"]?[0]) == "123" &&
                        bound["approval"]?["allowed_actor_ids"]
                        ?.AsArray().Count == 1,
                    "Approval did not bind the canonical donor ID"
                )
                Access(test, "check", issue: "1", owner: false)
                Access(test, "deny")
                let denied = Access(test, "check", issue: "1", code: 1, owner: false)
                Check.Contains(
                    denied.Error,
                    "Donor is denied. The owner must run: tokate access restore donor owner/project"
                )
                Claim(test, 1)
                Access(test, "restore")
                Access(test, "check", issue: "1", owner: false)
                test.Flow.Call([]string{"approve", "--yes", "owner/project#1"}, owner: true)
                Access(test, "check", issue: "1", code: mode == "open" ? 0: 1, owner: false)
                test.Flow.Call([]string{"approve", "--yes", "owner/project#1", "renamed"}, owner: true)
                if mode != "open" {
                    Claim(test, 1, 124)
                }
                let request = Claim(test)
                let run = test.Prepare()
                let saved = Check.Json(File.ReadAllText(Path.Combine(run, "run.json")))
                Check.That(
                    Check.Text(saved["policy_hash"]) == Check.Text(approval["policy_hash"]) && Check.Text(
                        saved["policy_hash"]
                    ) != Check.Hash(Path.Combine(test.Flow.Upstream, ".github/tokate.json")),
                    "Saved run did not retain the task-field approval digest"
                )
                let commit = test.Candidate(request)
                let policyPath = Path.Combine(test.Flow.Upstream, ".github/tokate.json")
                let updated = Check.Json(File.ReadAllText(policyPath))
                updated["eligibility"] = JsonValue.Create("open")
                updated["pr_text"] = JsonValue.Create("Owner notes")
                updated["close_message"] = JsonValue.Create("Ask the owner")
                updated["target_branch"] = JsonValue.Create("release")
                let keys = List[string]()
                for field in updated.AsObject() {
                    keys.Add(field.Key)
                }
                keys.Reverse()
                let reordered = JsonObject()
                for key in keys {
                    reordered[key] = updated[key]?.DeepClone()
                }
                File.WriteAllText(policyPath, "\n" + reordered.ToJsonString() + "\n")
                test.Flow.Commit("Change eligibility, descriptive fields and formatting during a claim")
                let current = Check.Envelope(
                    test.Flow.Call([]string{"status", "owner/project#1", "--json"}),
                    "status",
                    "ok"
                )
                Check.That(
                    Check.Text(current["data"]?["work"]?[0]?["approval_status"]) == "current" && Check.Text(
                        current["data"]?["work"]?[0]?["eligibility"]?["mode"]
                    ) == "open",
                    "Nontask edits revoked approval or retained the old access mode"
                )
                test.Flow.Call([]string{"external", "--yes", "--run", run, "--commit", commit})
                test.Flow.Call([]string{"submit", "--yes", "--run", run}, 8)
                let publish = Check.Json(File.ReadAllText(Path.Combine(run, "request.json")))
                test.Coordinate(test.Event(publish))
                test.Flow.Receipt("owner/project#10", owner: true)
                if version == 2 {
                    Policy(test, "open", 3)
                    test.Flow.Receipt("owner/project#10", owner: true)
                    Check.That(
                        Check.Text(test.State()["state"]?["approval_id"]) == Check.Text(state["approval_id"]),
                        "Version conversion replaced existing approval"
                    )
                }
                test.Flow.Reload()
                test.Flow.State["fork_owner_id"] = JsonValue.Create(124)
                test.Flow.Save()
                test.Flow.Receipt("owner/project#10", false, true)
                test.Flow.Reload()
                test.Flow.State["fork_owner_id"] = nil
                test.Flow.Save()
                Access(test, "deny")
                test.Flow.Receipt("owner/project#10", false, true)
                Check.Contains(
                    test.Flow.Call([]string{"submit", "--yes", "--run", run}, 1).Error,
                    "Donor is denied. The owner must run: tokate access restore donor owner/project"
                )
                test.Coordinate(test.Event(publish), 1)
                test.Flow.NoInference()
            }
        }

        private func Revocation(binary string) {
            for operation in[]string{"untrust", "deny"} {
                using let test = CoordinationFixture(binary)
                test.Initialize(approve: false)
                Setup(test, "trusted")
                Access(test, "trust")
                let claim = Claim(test)
                let run = test.Prepare("tokate")
                let saved = File.ReadAllText(Path.Combine(run, "run.json"))
                let state = Check.Text(test.State()["sha"])
                Access(test, operation)
                let refused = test.Flow.Call([]string{"work", "--yes", "--run", run}, 1)
                Check.Contains(
                    refused.Error,
                    operation == "deny" ? "Donor is denied. The owner must run: tokate access restore donor owner/project":
                    "Missing donor trust and issue approval access. The owner must run: tokate approve owner/project#1 donor"
                )
                Check.That(
                    File.ReadAllText(Path.Combine(run, "run.json")) == saved,
                    "Eligibility failure rewrote saved work"
                )
                Check.That(Check.Text(test.State()["sha"]) == state, "Membership edit changed contribution state")
                test.Prepare("tokate", 1)
                test.Coordinate(test.Event(claim), 1)
                test.Flow.NoInference()
                test.Flow.NoPr()
            }
            using let publication = CoordinationFixture(binary)
            publication.Initialize(approve: false)
            Setup(publication, "trusted")
            Access(publication, "trust")
            let request = Claim(publication)
            let run = publication.Prepare()
            let commit = publication.Candidate(request)
            publication.Flow.Call([]string{"external", "--yes", "--run", run, "--commit", commit})
            publication.Flow.Call([]string{"submit", "--yes", "--run", run}, 8)
            let publish = Check.Json(File.ReadAllText(Path.Combine(run, "request.json")))
            Access(publication, "untrust")
            publication.Coordinate(publication.Event(publish), 1)
            Check.That(publication.State()["state"]?["contribution"] == nil, "Untrusted PR gained authority")
            publication.Flow.NoInference()
        }

        private func Authority(binary string) {
            using let test = CoordinationFixture(binary)
            test.Initialize(approve: false)
            Setup(test, "open")
            Claim(test)
            let run = test.Prepare("tokate")
            let saved = File.ReadAllText(Path.Combine(run, "run.json"))
            using let baseline = FixtureSnapshot(test.Flow.Temp.Root)
            for fault in[]string{
                "unavailable",
                "repo",
                "actor",
                "malformed",
                "task",
                "policy",
                "approval_missing",
                "revoked",
                "label",
                "template"
            } {
                baseline.Restore()
                test.Flow.Reload()
                if fault == "approval_missing" {
                    test.Flow.Git("-C", test.Flow.Upstream, "update-ref", "-d", "refs/heads/tokate/contributions/1")
                } else if fault == "revoked" {
                    test.Flow.Call([]string{"revoke", "--yes", "owner/project#1"}, owner: true)
                } else if fault == "template" {
                    File.AppendAllText(Path.Combine(test.Flow.Upstream, ".github/tokate-pr.md"), "Changed template\n")
                    test.Flow.Commit("Owner changes PR template")
                } else if fault == "malformed" {
                    let blob = test.Flow.Git("-C", test.Flow.Upstream, "rev-parse", "HEAD")
                    test.Flow.Git("-C", test.Flow.Upstream, "update-ref", "refs/heads/tokate/access", blob)
                } else if fault == "policy" {
                    Policy(test, "trusted")
                    let status = Check.Envelope(
                        test.Flow.Call([]string{"status", "owner/project#1", "--json"}),
                        "status",
                        "ok"
                    )
                    Check.That(
                        Check.Text(status["data"]?["work"]?[0]?["approval_status"]) == "current" && Check.Text(
                            status["data"]?["work"]?[0]?["eligibility_status"]
                        ) == "access_waiting",
                        "Eligibility restriction revoked approval instead of checking current access"
                    )
                } else {
                    test.Flow.Reload()
                    if fault == "unavailable" {
                        test.Flow.State["fault_path"] = JsonValue.Create(
                            "repos/owner/project/git/ref/heads/tokate/access"
                        )
                        test.Flow.State["faults"] = Check.Json("[{\"status\":403}]")
                    } else if fault == "repo" {
                        test.Flow.State["repo_id"] = JsonValue.Create(99)
                    } else if fault == "actor" {
                        test.Flow.State["viewer_id"] = JsonValue.Create("123")
                    } else {
                        let issue = test.Flow.State["issue"] ?? throw Exception("Missing issue")
                        if fault == "label" {
                            issue["labels"] = JsonArray()
                        } else {
                            issue["title"] = JsonValue.Create("Changed task")
                        }
                    }
                    test.Flow.Save()
                }
                let refused = test.Flow.Call([]string{"work", "--yes", "--run", run}, 1)
                if fault == "task" {
                    Check.Contains(
                        refused.Error,
                        "Issue text changed since approval. The owner must run: tokate approve owner/project#1"
                    )
                } else if fault == "policy" {
                    Check.Contains(
                        refused.Error,
                        "Eligibility mode: trusted. Missing donor trust and issue approval access."
                    )
                } else if fault == "approval_missing" {
                    Check.Contains(
                        refused.Error,
                        "Issue is not approved. Approval record is missing. The owner must run: tokate approve owner/project#1"
                    )
                } else if fault == "revoked" || fault == "label" {
                    Check.Contains(
                        refused.Error,
                        "Issue approval is revoked or its approval label is missing. The owner must run: tokate approve owner/project#1"
                    )
                } else if fault == "template" {
                    Check.Contains(
                        refused.Error,
                        "PR template changed. The owner must run: tokate approve owner/project#1"
                    )
                }
                Check.That(
                    File.ReadAllText(Path.Combine(run, "run.json")) == saved,
                    "Unknown authority rewrote saved work"
                )
                test.Flow.NoInference()
                test.Flow.NoPr()
            }
        }

        private func Transport(binary string) {
            using let test = CoordinationFixture(binary)
            test.Initialize(approve: false)
            Setup(test, "open")
            Access(test, "trust", code: 1, owner: false)
            test.Flow.Mode("lost_access_response")
            test.Flow.ResetTraffic()
            let mutation = Access(test, "trust", traffic: true)
            test.Flow.Traffic(7, 3, 0, mutation)
            let reference = test.Flow.Git("-C", test.Flow.Upstream, "rev-parse", "refs/heads/tokate/access")
            let parents = test.Flow.Git("-C", test.Flow.Upstream, "rev-list", "--parents", "-n", "1", reference)
            Check.That(parents.Split(' ').Length == 2, "Access write lacks single parent")
            test.Flow.ResetTraffic()
            let gate = Access(test, "check", issue: "1", owner: false, traffic: true)
            test.Flow.Traffic(11, 0, 0, gate)
            test.Flow.Mode("lost_state_response")
            let request = Claim(test)
            let sha = Check.Text(test.State()["sha"])
            test.Coordinate(test.Event(request))
            let output = Check.Envelope(
                test.Flow.Call([]string{"access", "check", "owner/project#1", "--json"}),
                "access",
                "ok"
            )
            Check.That(
                Check.Text(output["data"]?["eligible"]) == "true" && Check.Text(
                    output["data"]?["eligibility"]
                ) == "open",
                "Eligibility JSON lost bounded gate result"
            )
            Check.That(Check.Text(test.State()["sha"]) == sha, "Duplicate claim repeated effects")
            let denied = Check.Envelope(
                test.Flow.Call([]string{"access", "--yes", "deny", "donor", "owner/project", "--json"}, owner: true),
                "access",
                "ok"
            )
            Check.That(Check.Text(denied["data"]?["actor"]) == "123", "Owner JSON lacks numeric actor")
            let rejected = Check.Envelope(
                test.Flow.Call([]string{"access", "check", "owner/project#1", "--json"}, 1),
                "access",
                "error",
                "invalid_state"
            )
            Check.That(
                Check.Text(rejected["data"]?["eligible"]) == "false" && rejected["next_actions"]?.AsArray().Count > 0,
                "Denied JSON lacks gate failure or next action"
            )
            test.Coordinate(test.Event(request), 1)
            test.Flow.NoInference()
            test.Flow.NoPr()
        }

        private func Traffic(binary string) {
            using let test = CoordinationFixture(binary)
            test.Initialize(approve: false)
            Setup(test, "trusted")
            test.Flow.ResetTraffic()
            let trusted = Access(test, "trust", traffic: true)
            test.Flow.Traffic(5, 3, 0, trusted)
            let claim = test.ClaimRequest()
            let path = test.Event(claim)
            test.Flow.ResetTraffic()
            let acquired = test.Coordinate(path, traffic: true)
            test.Flow.Traffic(35, 3, 0, acquired)
            let run = test.Prepare("tokate")
            test.Flow.Call([]string{"work", "--yes", "--run", run})
            test.Flow.Call([]string{"submit", "--yes", "--run", run}, 8)
            let publish = Check.Json(File.ReadAllText(Path.Combine(run, "request.json")))
            test.Coordinate(test.Event(publish))
            test.Flow.Receipt("owner/project#10", owner: true)
            test.Flow.Reload()
            Check.That(
                Check.Text(test.Flow.State["exec_count"]) == "1",
                "Eligible managed work did not execute exactly once"
            )
        }

        private func LatePublication(binary string) {
            for amend in[]bool{true, false} {
                using let test = CoordinationFixture(binary)
                test.Initialize(approve: false)
                Setup(test, "open")
                let claim = Claim(test)
                let previous = test.Candidate(claim)
                var request = test.PublishRequest(claim, previous)
                let branch = "tokate/v2-" + Check.Text(claim["uuid"])
                if amend {
                    test.Coordinate(test.Event(request))
                    let checkout = Path.Combine(test.Flow.Temp.Root, "donor-work")
                    File.AppendAllText(Path.Combine(checkout, "result.txt"), "Reviewed change\n")
                    test.Flow.Git("-C", checkout, "add", ".")
                    test.Flow.DonorGit(checkout, "commit", "-m", "Review correction")
                    let head = test.Flow.Git("-C", checkout, "rev-parse", "HEAD")
                    test.Flow.Git(
                        "-C",
                        checkout,
                        "push",
                        Path.Combine(test.Flow.Bin, "fork"),
                        "HEAD:refs/heads/" + branch
                    )
                    test.Flow.Reload()
                    let pullHead = test.Flow.State["pulls"]?[0]?["head"] ?? throw Exception("Missing PR head")
                    pullHead["sha"] = JsonValue.Create(head)
                    test.Flow.Save()
                    let state = test.State()
                    request = Check.Map(
                        "uuid",
                        Guid.NewGuid().ToString("D"),
                        "expected",
                        Check.Text(state["sha"]),
                        "approval",
                        Check.Text(state["state"]?["approval_id"]),
                        "action",
                        "amend",
                        "metadata",
                        Check.Map(
                            "fork",
                            "donor/project",
                            "branch",
                            branch,
                            "previous",
                            previous,
                            "head",
                            head,
                            "pr",
                            10,
                            "seconds",
                            30,
                            "tools",
                            JsonArray(),
                            "verification",
                            "donor-reported-pass",
                            "attempt",
                            Check.Text(state["state"]?["reservation"]?["attempt"])
                        )
                    )
                }
                let stateBefore = Check.Text(test.State()["sha"])
                test.Flow.Reload()
                let bodyBefore = Check.Text(test.Flow.State["pulls"]?[0]?["body"])
                let path = amend ? "repos/owner/project/pulls/10": "repos/donor/project/git/ref/heads/" + branch
                test.Flow.State["access_revoke_after_path"] = JsonValue.Create(path)
                test.Flow.State["access_revoke_after_read"] = JsonValue.Create(2)
                test.Flow.Save()
                test.Flow.ResetTraffic()
                let failure = test.Coordinate(test.Event(request), 1)
                test.Flow.Reload()
                Check.That(
                    Check.Text(test.Flow.State["access_revoked_on_read"]) == "true",
                    "Late revocation did not run: " + failure.Error
                )
                for call in test.Flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                    Check.That(
                        Check.Text(call["method"]) == "GET" || !Check.Text(call["path"]).StartsWith(
                            "repos/owner/project/pulls"
                        ),
                        "Revoked donor wrote a PR after downstream evidence read: " + call?.ToJsonString()
                    )
                }
                Check.That(
                    test.Flow.State["pulls"]?.AsArray().Count == 1 && Check.Text(
                        test.Flow.State["pulls"]?[0]?["body"]
                    ) == bodyBefore,
                    "Revoked publication changed the donor draft"
                )
                Check.That(
                    Check.Text(test.State()["sha"]) == stateBefore,
                    "Revoked publication changed contribution state"
                )
                test.Flow.NoInference()
            }
        }

        private func RevokeAt(test CoordinationFixture, read int32) {
            test.Flow.Reload()
            test.Flow.State["access_reads"] = JsonValue.Create(0)
            test.Flow.State["access_revoke_at"] = JsonValue.Create(read)
            test.Flow.Save()
        }

        private func Races(binary string) {
            for read in[]int32{2, 3} {
                using let test = CoordinationFixture(binary)
                test.Initialize(approve: false)
                Setup(test, "open")
                RevokeAt(test, read)
                Claim(test, 1)
                test.Prepare("tokate", 1)
                test.Flow.NoInference()
                test.Flow.NoPr()
            }
            using let execution = CoordinationFixture(binary)
            execution.Initialize(approve: false)
            Setup(execution, "open")
            Claim(execution)
            let run = execution.Prepare("tokate")
            RevokeAt(execution, 2)
            execution.Flow.Call([]string{"work", "--yes", "--run", run}, 1)
            execution.Flow.NoInference()
            execution.Flow.NoPr()
            for read in[]int32{2, 4} {
                using let test = CoordinationFixture(binary)
                test.Initialize(approve: false)
                Setup(test, "open")
                let claim = Claim(test)
                let saved = test.Prepare()
                let commit = test.Candidate(claim)
                test.Flow.Call([]string{"external", "--yes", "--run", saved, "--commit", commit})
                test.Flow.Call([]string{"submit", "--yes", "--run", saved}, 8)
                let publish = Check.Json(File.ReadAllText(Path.Combine(saved, "request.json")))
                RevokeAt(test, read)
                test.Coordinate(test.Event(publish), 1)
                test.Flow.Reload()
                Check.That(
                    test.Flow.State["pulls"]?.AsArray().Count == 1,
                    "Rejected adoption did not preserve donor PR"
                )
                test.Flow.Receipt("owner/project#10", false, true)
                Check.That(test.State()["state"]?["contribution"] == nil, "Revoked access authorized publication")
                test.Flow.NoInference()
            }
            using let conflict = CoordinationFixture(binary)
            conflict.Initialize(approve: false)
            Setup(conflict, "trusted")
            conflict.Flow.Mode("access_conflict")
            conflict.Flow.ResetTraffic()
            Access(conflict, "trust", code: 1, traffic: true)
            conflict.Flow.Reload()
            var patches int32
            for call in conflict.Flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                if Check.Text(call["path"]) == "repos/owner/project/git/refs/heads/tokate/access" {
                    patches++
                }
            }
            Check.That(patches == 1, "Conflicting access write was repeated")
            Access(conflict, "check", issue: "1", code: 1, owner: false)
            using let creation = CoordinationFixture(binary)
            creation.Initialize(approve: false)
            Setup(creation, "trusted")
            creation.Flow.Git("-C", creation.Flow.Upstream, "update-ref", "-d", "refs/heads/tokate/access")
            creation.Flow.Mode("access_create_conflict")
            creation.Flow.ResetTraffic()
            Access(creation, "trust", donor: "other")
            creation.Flow.Reload()
            var creates int32
            var updates int32
            for call in creation.Flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                if Check.Text(call["method"]) == "POST" && Check.Text(call["path"]) == "repos/owner/project/git/refs" {
                    creates++
                }
                if Check.Text(call["method"]) == "PATCH" && Check.Text(
                    call["path"]
                ) == "repos/owner/project/git/refs/heads/tokate/access" {
                    updates++
                }
            }
            Check.That(creates == 1 && updates == 1, "First access write did not retry creation as one update")
            Access(creation, "check", issue: "1", code: 1, owner: false)
            let current = Check.Json(
                creation.Flow.Git("-C", creation.Flow.Upstream, "show", "refs/heads/tokate/access:access.json")
            )
            Check.That(current["members"]?.AsArray().Count == 2, "Creation retry lost concurrent donor access")
        }

        private func AccessRecord(test CoordinationFixture) {
            for invalid in map[string, string]{
                "{\"version\":\"1\",\"repo_id\":1,\"members\":[]}": "version",
                "{\"version\":1,\"repo_id\":1,\"members\":[{\"actor\":123,\"trusted\":true}]}": "denied"
            } {
                test.Flow.Reload()
                test.Flow.State["access_override"] = JsonValue.Create(invalid.Key)
                test.Flow.Save()

                let rejected = Check.Envelope(
                    test.Flow.Call([]string{"access", "list", "owner/project", "--json"}, 1, true),
                    "access",
                    "error",
                    "invalid_state"
                )
                let message = Check.Text(rejected["error"]?["message"])
                Check.Contains(message, "Access record")
                Check.Contains(message, "\"" + invalid.Value + "\"")
            }

            test.Flow.Reload()
            test.Flow.State["access_override"] = JsonValue.Create(
                "{\"version\":1,\"repo_id\":1,\"members\":[{\"denied\":false,\"trusted\":true,\"actor\":9007199254740993},{\"actor\":124,\"trusted\":true,\"denied\":false,\"issues\":[]}]}"
            )
            test.Flow.Save()
            Access(test, "trust")

            Check.That(
                test.Flow.Git("-C", test.Flow.Upstream, "show", "tokate/access:access.json").TrimEnd() ==
                "{\"version\":1,\"repo_id\":1,\"members\":[{\"denied\":false,\"trusted\":true,\"actor\":9007199254740993},{\"actor\":124,\"trusted\":true,\"denied\":false},{\"actor\":123,\"trusted\":true,\"denied\":false}]}",
                "Access record rewrite changed stored bytes or legacy membership migration"
            )
        }

        private func Declarations(binary string) {
            using let test = CoordinationFixture(binary)
            test.Initialize()
            let path = Path.Combine(test.Flow.Upstream, ".github/tokate.json")
            let original = File.ReadAllText(path)
            let incomplete = Check.Json(original)
            incomplete.AsObject().Remove("approval_scope")
            incomplete.AsObject().Remove("eligibility")
            for invalid in[]string{
                "\"eligibility\":\"open\"",
                "\"approval_scope\":\"task\"",
                "\"eligibility\":\"Open\",\"approval_scope\":\"task\"",
                "\"eligibility\":null,\"approval_scope\":\"task\"",
                "\"eligibility\":\"open\",\"approval_scope\":\"donor\"",
                "\"eligibility\":\"open\",\"eligibility\":\"manual\",\"approval_scope\":\"task\"",
                "\"eligibility\":\"open\",\"approval_scope\":\"task\",\"version\":2"
            } {
                File.WriteAllText(path, incomplete.ToJsonString().TrimEnd('}') + "," + invalid + "}")
                test.Flow.Commit("Malformed owner declaration")
                test.Flow.Call([]string{"approve", "--yes", "owner/project#1"}, 1, true)
            }
            File.WriteAllText(path, original)
            test.Flow.Commit("Restore current policy")
            Policy(test, "open")
            test.Flow.Call([]string{"approve", "--yes", "owner/project#1", "donor", "other"}, 1, true)
            test.Flow.Call([]string{"approve", "--yes", "owner/project#1"}, owner: true)
            for text in[]string{
                "{\"version\":1,\"repo_id\":99,\"members\":[]}",
                "{\"version\":1,\"repo_id\":1,\"members\":[{\"actor\":\"123\",\"trusted\":true,\"denied\":false}]}",
                "{\"version\":1,\"repo_id\":1,\"members\":[],\"pending\":[]}",
                "{\"version\":1,\"repo_id\":1,\"members\":[{\"actor\":123,\"trusted\":false,\"denied\":false}]}"
            } {
                test.Flow.Reload()
                test.Flow.State["access_override"] = JsonValue.Create(text)
                test.Flow.Save()
                Access(test, "check", issue: "1", code: 1, owner: false)
                Claim(test, 1)
            }
            AccessRecord(test)
            test.Flow.Reload()
            test.Flow.State["access_override"] = nil
            test.Flow.Save()
            Policy(test, "trusted")
            test.Flow.State["access_override"] = JsonValue.Create(
                "{\"version\":1,\"repo_id\":1,\"members\":[{\"actor\":123,\"trusted\":false,\"denied\":false,\"issues\":[1]},{\"actor\":124,\"trusted\":true,\"denied\":false,\"issues\":[]},{\"actor\":125,\"trusted\":false,\"denied\":true,\"issues\":[1]}]}"
            )
            test.Flow.Save()
            Access(test, "check", issue: "1", code: 1, owner: false)
            Access(test, "trust")
            let migrated = Check.Json(test.Flow.Git("-C", test.Flow.Upstream, "show", "tokate/access:access.json"))
            Check.That(
                migrated["members"]?.AsArray().Count == 3 && !migrated.ToJsonString().Contains("\"issues\""),
                "Access write did not preserve trust and denial while removing old issue grants"
            )
            test.Flow.Reload()
            test.Flow.State["access_override"] = nil
            test.Flow.Save()
            Policy(test, "open")
            let state = test.State()["state"] ?? throw Exception("Missing state")
            let approval = state["approval"] ?? throw Exception("Missing approval")
            approval["donor"] = JsonValue.Create("donor")
            test.RewriteState(state)
            Claim(test, 1)
            test.Flow.NoInference()
            test.Flow.NoPr()
            using let routes = CoordinationFixture(binary)
            routes.Initialize(approve: false)
            let routePath = Path.Combine(routes.Flow.Upstream, ".github/tokate.json")
            let routePolicy = Check.Json(File.ReadAllText(routePath))
            routePolicy["version"] = JsonValue.Create(3)
            routePolicy.AsObject().Remove("models")
            routePolicy["allowed_tools"] = Check.Json(
                "[{\"harness\":\"omp\",\"provider\":\"openai\",\"models\":{\"expensive\":[\"high\"]}},{\"harness\":\"omp\",\"provider\":\"openrouter\",\"models\":{\"cheap\":[\"high\"]}},{\"harness\":\"aider\",\"provider\":\"openrouter\"}]"
            )
            File.WriteAllText(routePath, routePolicy.ToJsonString())
            routes.Flow.Commit("Owner sets exact provider model routes")
            Setup(routes, "open")
            Claim(routes)
            File.WriteAllText(
                routes.Tools,
                "[{\"harness\":\"omp\",\"provider\":\"openrouter\",\"model\":\"expensive\",\"effort\":\"high\"}]"
            )
            routes.Prepare(code: 1)
            Check.That(
                !Directory.Exists(Path.Combine(routes.Flow.Temp.Root, "runs")),
                "Rejected model route created work"
            )
            File.WriteAllText(
                routes.Tools,
                "[{\"harness\":\"omp\",\"provider\":\"openai\",\"model\":\"expensive\",\"effort\":\"high\"},{\"harness\":\"omp\",\"provider\":\"openrouter\",\"model\":\"cheap\",\"effort\":\"high\"},{\"harness\":\"aider\",\"provider\":\"openrouter\",\"model\":\"another-model\",\"effort\":\"absent\"}]"
            )
            let routeRun = routes.Prepare()
            let savedRoutes = Check.Json(File.ReadAllText(Path.Combine(routeRun, "run.json")))
            Check.That(savedRoutes["tools"]?.AsArray().Count == 3, "Mixed model permissions lost a declaration")
            routes.Flow.NoInference()
            routes.Flow.NoPr()
        }

        private func Presentation(binary string) {
            using let health = CoordinationFixture(binary)
            health.Initialize()
            let version = TestProcess
                .Run(binary, []string{"--version"}, health.Flow.Temp.Env)
                .Output
                .Trim()
                .Split(' ')[1]
            let workflows = Path.Combine(health.Flow.Upstream, ".github/workflows")
            Directory.CreateDirectory(workflows)
            File.WriteAllText(
                Path.Combine(workflows, "tokate-coordinator.yml"),
                "jobs:\n  coordinate:\n    uses: obselate/tokate/.github/workflows/tokate-shared.yml@" +
                    String('a', 40) +
                    "\n"
            )
            health.Flow.Commit("Add owner workflow")
            health.Flow.Call([]string{"approve", "--yes", "owner/project#1"}, owner: true)
            health.Flow.Reload()
            health.Flow.State["release_version"] = JsonValue.Create(version)
            health.Flow.State["actions_permissions"] = Check.Map("enabled", true, "allowed_actions", "selected")
            health.Flow.State["workflow_runs"] = Check.Json(
                "[{\"status\":\"completed\",\"conclusion\":\"startup_failure\",\"html_url\":\"https://example.test/coordinator\"}]"
            )
            health.Flow.Save()
            let healthArgs = []string{"doctor", "repo", "owner/project", "--json"}
            for pattern in[]string{
                "actions/*",
                "obselate/tokate/.github/workflows/tokate-shared.yml@" + String('b', 40),
                "obselate/*",
                "*, !Obselate/Tokate/.github/workflows/tokate-shared.yml@*"
            } {
                health.Flow.Reload()
                let patterns = JsonArray()
                for value in pattern.Split(", ") {
                    patterns.Add(JsonValue.Create(value) as JsonNode)
                }
                health.Flow.State["selected_actions"] = Check.Map("patterns_allowed", patterns)
                health.Flow.Save()
                health.Flow.ResetTraffic()
                let result = Check.Envelope(health.Flow.Call(healthArgs, owner: true), "doctor", "ok")
                var allowlist JsonNode? = nil
                for row in result["data"]?["checks"]?.AsArray() ?? JsonArray() {
                    if Check.Text(row["check"]) == "workflow_allowlist" {
                        allowlist = row
                    }
                }
                Check.That(
                    Check.Text(allowlist?["status"]) == (pattern == "obselate/*" ? "ok": "problem"),
                    "Owner doctor misread the pinned workflow allowlist"
                )
            }
            for reference in[]string{String('a', 40), "v0"} {
                if reference == "v0" {
                    File.WriteAllText(
                        Path.Combine(workflows, "tokate-coordinator.yml"),
                        "jobs:\n  coordinate:\n    uses: obselate/tokate/.github/workflows/tokate-shared.yml@" +
                            reference +
                            "\n"
                    )
                    health.Flow.Commit("Select coordinator reference")
                }
                health.Flow.Reload()
                health.Flow.State["release_version"] = JsonValue.Create("0.0.1")
                health.Flow.Save()
                let result = Check.Envelope(health.Flow.Call(healthArgs, owner: true), "doctor", "ok")
                for row in result["data"]?["checks"]?.AsArray() ?? JsonArray() {
                    if Check.Text(row["check"]) == "coordinator" {
                        Check.That(
                            Check.Text(row["status"]) == (reference == "v0" ? "ok": "warning"),
                            "Owner doctor must warn about versions only in pin mode"
                        )
                    }
                }
            }
            let policyPath = Path.Combine(health.Flow.Upstream, ".github/tokate.json")
            let changedPolicy = Check.Json(File.ReadAllText(policyPath))
            changedPolicy["max_seconds"] = JsonValue.Create(3601)
            File.WriteAllText(policyPath, changedPolicy.ToJsonString())
            health.Flow.Commit("Change approved task fields")
            health.Flow.Git("-C", health.Flow.Upstream, "update-ref", "-d", "refs/heads/tokate/access")
            let broken = Check.Envelope(health.Flow.Call(healthArgs, owner: true), "doctor", "ok")
            Check.Contains(broken.ToJsonString(), "startup_failure")
            for row in broken["data"]?["checks"]?.AsArray() ?? JsonArray() {
                if Check.Text(row["check"]) == "last_run" {
                    Check.Contains(Check.Text(row["message"]), "repository's Actions settings")
                }
            }
            health.Flow.Reload()
            for call in health.Flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                Check.That(Check.Text(call["method"]) == "GET", "Owner health check mutated repository data")
            }
            var missing bool
            var stale bool
            for row in broken["data"]?["checks"]?.AsArray() ?? JsonArray() {
                missing = missing ||
                    (
                    Check.Text(row["check"]) == "access" && Check.Text(row["status"]) == "ok" && Check.Text(
                        row["present"]
                    ) == "false"
                )
                stale = stale ||
                    (
                    Check.Text(row["check"]) == "approval" && Check.Text(row["status"]) == "problem" && Check.Text(
                        row["issue"]
                    ) == "1"
                )
            }
            Check.That(missing && stale, "Owner doctor omitted empty access or stale approval")
            let next = broken["next_actions"]?.ToJsonString() ?? ""
            Check.That(!next.Contains("[\"tokate\",\"access\",\"init\""), "Empty access needs no initialization")
            Check.Contains(next, "[\"tokate\",\"approve\",\"owner/project#1\"]")
            let human = health.Flow.Call([]string{"doctor", "repo", "owner/project"}, owner: true).Output
            Check.Contains(human, "Empty access record")
            Check.Contains(human, "tokate approve owner/project#1")
            Check.Contains(human, "Settings > Actions > General")
            health.Flow.State["actions_permissions"] = Check.Map("enabled", false)
            health.Flow.Save()
            let disabled = Check.Envelope(health.Flow.Call(healthArgs, owner: true), "doctor", "ok")
            Check.That(
                !disabled.ToJsonString().Contains("workflow_allowlist"),
                "Disabled Actions checked the allowlist"
            )
            for row in disabled["data"]?["checks"]?.AsArray() ?? JsonArray() {
                if Check.Text(row["check"]) == "actions" {
                    Check.That(Check.Text(row["status"]) == "problem", "Disabled Actions were not reported")
                }
            }
            health.Flow.NoInference()
            using let empty = CoordinationFixture(binary)
            empty.Initialize(approve: false)
            let notice = "Tokate keeps its state in tokate/ branches; do not open or merge pull requests from them."
            Check.That(
                Access(empty, "init").Output.Trim() == "Initialized donor access for owner/project.\n" + notice,
                "Access initialization did not explain the change"
            )
            Check.Contains(
                empty.Flow.Call([]string{"access", "list", "owner/project"}).Output,
                "No donor access or pending requests."
            )
            let first = empty.Flow.Call([]string{"approve", "--yes", "owner/project#1"}, owner: true)
            Check.That(
                first
                    .Output
                    .Trim()
                    .EndsWith(
                    "Approved https://github.com/owner/project/issues/1. Donors start with: tokate work owner/project#1 --harness HARNESS --model MODEL --effort EFFORT --time TIME\n" +
                        notice
                ),
                "First repository approval did not explain state branches"
            )
            let repeatedApproval = empty.Flow.Call([]string{"approve", "--yes", "owner/project#1"}, owner: true)
            Check.That(!repeatedApproval.Output.Contains(notice), "Repeated approval repeated the state notice")
            empty.Flow.Reload()
            let secondIssue = empty.Flow.State["issue"] ?? throw Exception("Missing issue")
            secondIssue["number"] = JsonValue.Create(2)
            empty.Flow.Save()
            let laterApproval = empty.Flow.Call([]string{"approve", "--yes", "owner/project#2"}, owner: true)
            Check.That(!laterApproval.Output.Contains(notice), "Later issue approval repeated the state notice")
            using let structured = CoordinationFixture(binary)
            structured.Initialize(approve: false)
            for command in[][]string{
                []string{"access", "--yes", "init", "owner/project", "--json"},
                []string{"approve", "--yes", "owner/project#1", "--json"}
            } {
                let result = structured.Flow.Call(command, owner: true)
                Check.Envelope(result, command[0], "ok")
                Check.That(!(result.Output + result.Error).Contains(notice), "JSON output emitted the state notice")
            }
            using let test = CoordinationFixture(binary)
            test.Initialize(approve: false)
            Setup(test, "trusted")
            let args = []string{"access", "--yes", "request", "owner/project#1", "--trust", "--json"}
            let requested = Check.Envelope(test.Flow.Call(args), "access", "ok")
            Check.That(Check.Text(requested["data"]?["posted"]) == "true", "Donor request was not posted")
            test.Flow.Reload()
            let commentId = Check.Text(requested["data"]?["comment"])
            let comment = test.Flow.State["comments"]?[commentId] ?? throw Exception("Missing request")
            comment["issue_url"] = JsonValue.Create("https://api.github.com/repos/Owner/Project/issues/1")
            test.Flow.Save()
            let repeated = Check.Envelope(test.Flow.Call(args), "access", "ok")
            Check.That(
                Check.Text(repeated["data"]?["posted"]) == "false",
                "Case-variant request posted duplicate comments"
            )
            let listArgs = []string{"access", "list", "owner/project", "--json"}
            let pending = Check.Envelope(test.Flow.Call(listArgs, owner: true), "access", "ok")
            Check.That(pending["data"]?["pending"]?.AsArray().Count == 1, "Pending request was hidden")
            let pendingText = test.Flow.Call([]string{"access", "list", "owner/project"}).Output
            Check.Contains(pendingText, "Pending request: donor #1 (trust)")
            Check.That(!pendingText.Contains("access_sha"), "Human access list exposed raw JSON")
            Claim(test, 1)
            Check.That(
                Access(test, "trust").Output.Trim() == "Trusted donor for future approved issues.",
                "Access trust did not explain the change"
            )
            Check.Contains(test.Flow.Call([]string{"access", "list", "owner/project"}).Output, "Trusted donor: donor")
            Check.That(
                Access(test, "check", issue: "1", owner: false).Output.Trim() ==
                "You are eligible for approved issue #1.",
                "Access check exposed raw JSON"
            )
            let trusted = Check.Envelope(test.Flow.Call(listArgs, owner: true), "access", "ok")
            Check.That(
                trusted["data"]?["pending"]?.AsArray().Count == 0 && Check.Text(
                    trusted["data"]?["trusted"]?[0]?["donor"]
                ) == "donor",
                "Trusted donor presentation did not resolve the request"
            )
            Access(test, "untrust")
            Access(test, "check", issue: "1", code: 1, owner: false)
            let restored = Check.Envelope(test.Flow.Call(listArgs), "access", "ok")
            Check.That(
                restored["data"]?["pending"]?.AsArray().Count == 1 && restored["data"]?["trusted"]?.AsArray()
                    .Count == 0,
                "Revocation presentation retained trust"
            )
            test.Flow.Call([]string{"access", "--yes", "request", "owner/project#1"})
            test.Flow.Call([]string{"approve", "--yes", "owner/project#1", "donor"}, owner: true)
            let approvedRequests = Check.Envelope(test.Flow.Call(listArgs), "access", "ok")
            Check.That(
                approvedRequests["data"]?["pending"]?.AsArray().Count == 1,
                "Issue approval did not resolve only the issue access request"
            )
            Access(test, "deny", donor: "other")
            let accessText = test.Flow.Call([]string{"access", "list", "owner/project"}).Output
            Check.Contains(accessText, "Denied donor: other")
            Check.That(!accessText.Contains("access_sha"), "Human access list exposed raw JSON")
            File.Delete(Path.Combine(test.Flow.Upstream, ".github/tokate-pr.md"))
            let path = Path.Combine(test.Flow.Upstream, ".github/tokate.json")
            let policy = Check.Json(File.ReadAllText(path))
            policy["target_branch"] = JsonValue.Create("release")
            policy["pr_text"] = JsonValue.Create("Literal {{issue}} owner text")
            policy["close_message"] = JsonValue.Create("Owner review required.")
            File.WriteAllText(path, policy.ToJsonString())
            test.Flow.Commit("Built-in PR format with literal owner text")
            test.Flow.Git("-C", test.Flow.Upstream, "branch", "release")
            test.Flow.Call([]string{"approve", "--yes", "owner/project#1", "donor"}, owner: true)
            Check.That(
                Check.Text(test.State()["state"]?["approval"]?["base_branch"]) == "release",
                "Configured target was not used for approval"
            )
            let claim = Claim(test)
            let run = test.Prepare()
            let commit = test.Candidate(claim)
            test.Flow.Call([]string{"external", "--yes", "--run", run, "--commit", commit})
            test.Flow.Call([]string{"submit", "--yes", "--run", run}, 8)
            let publication = Check.Json(File.ReadAllText(Path.Combine(run, "request.json")))
            test.Coordinate(test.Event(publication))
            test.Flow.Reload()
            Check.That(
                Check.Text(test.Flow.State["pulls"]?[0]?["user"]?["login"]) == "donor",
                "Coordinator changed the donor PR author"
            )
            let body = Check.Text(test.Flow.State["pulls"]?[0]?["body"])
            Check.Contains(body, "Fixes #1")
            Check.Contains(body, "Literal {{issue}} owner text")
            test.Flow.Receipt("owner/project#10", owner: true)
            test.Flow.ResetTraffic()
            let history = Check.Envelope(
                test.Flow.Call([]string{"access", "history", "donor", "owner/project", "--json"}),
                "access",
                "ok"
            )
            Check.That(
                history["data"]?["history"]?.AsArray().Count == 1 && Check.Text(
                    history["data"]?["history"]?[0]?["pr"]
                ) == "10" &&
                    Check.Text(history["data"]?["history"]?[0]?["donor"]) == "donor",
                "Contribution history omitted the PR"
            )
            Check.Contains(Check.Text(history["data"]?["history"]?[0]?["evidence"]), "unverified")
            test.Flow.Reload()
            let pull = test.Flow.State["pulls"]?[0] ?? throw Exception("Missing history PR")
            let head = pull["head"]?["repo"] ?? throw Exception("Missing history head repository")
            let owner = head["owner"]?.DeepClone() ?? throw Exception("Missing history head owner")
            head["owner"] = Check.Map("login", "other", "id", 124)
            test.Flow.Save()
            let forged = Check.Envelope(
                test.Flow.Call([]string{"access", "history", "donor", "owner/project", "--json"}),
                "access",
                "ok"
            )
            Check.That(
                forged["data"]?["history"]?.AsArray().Count == 0,
                "Forged receipt attributed a PR to another donor"
            )
            let mismatch = Check.Envelope(
                test.Flow.Call([]string{"access", "history", "other", "owner/project", "--json"}),
                "access",
                "ok"
            )
            Check.That(
                mismatch["data"]?["history"]?.AsArray().Count == 0,
                "Mismatched head owner and receipt entered history"
            )
            test.Flow.Reload()
            let restoredPull = test.Flow.State["pulls"]?[0] ?? throw Exception("Missing history PR")
            let restoredRepo = restoredPull["head"]?["repo"] ?? throw Exception("Missing history head repository")
            restoredRepo["owner"] = owner
            test.Flow.Save()
            for call in test.Flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                Check.That(Check.Text(call["method"]) == "GET", "History mutated authority")
            }
            policy["close_message"] = JsonValue.Create("Changed admission message")
            File.WriteAllText(path, policy.ToJsonString())
            test.Flow.Commit("Change optional text")
            test.Flow.Receipt("owner/project#10", owner: true)
            File.WriteAllText(
                Path.Combine(test.Flow.Upstream, ".github/tokate-pr.md"),
                TestResources.Template("tokate-pr.md") + "Changed template\n"
            )
            test.Flow.Commit("Change PR template")
            Check.Contains(
                test.Flow.Call([]string{"checks", "owner/project#10"}, 1, true).Error,
                "PR template changed."
            )
            test.Flow.NoInference()
        }

        internal func All(binary string, selected string) {
            switch selected {
                case "EligibilityPresentation" {
                    Presentation(binary)
                }
                case "EligibilityTraffic" {
                    Traffic(binary)
                }
                case "EligibilityRaces" {
                    Races(binary)
                }
                case "EligibilityLatePublication" {
                    LatePublication(binary)
                }
                case "EligibilityDeclarations" {
                    Declarations(binary)
                }
                case "EligibilityModes" {
                    Modes(binary)
                }
                case "EligibilityRevocation" {
                    Revocation(binary)
                }
                case "EligibilityAuthority" {
                    Authority(binary)
                }
                case "EligibilityTransport" {
                    Transport(binary)
                }
                case "EligibilityConcurrency" {
                    using let test = CoordinationFlow(binary)
                    test.Initialize(approve: false)
                    Setup(test, "open")
                    test.Flow.ResetTraffic()
                    test.SimultaneousClaims()
                }
            }
            Console.WriteLine("PASS V2 " + selected)
        }
    }
}
