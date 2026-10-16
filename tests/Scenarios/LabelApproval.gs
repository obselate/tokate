package TokateTests

import System
import System.IO
import System.Text.Json.Nodes

internal partial class CoordinationFlow {
    shared {
        internal func LabelApprovalPermissions(binary string) {
            using let test = CoordinationFixture(binary)
            test.Initialize(approve: false)
            test.Flow.OwnerAccess()
            test.Flow.Git("-C", test.Flow.Upstream, "checkout", "-b", "release/next")
            File.WriteAllText(Path.Combine(test.Flow.Upstream, "DECREE.md"), "Approved target instructions.\n")
            File.WriteAllText(Path.Combine(test.Flow.Upstream, ".github/tokate-pr.md"), "Untrusted target template\n")
            test.Flow.Commit("Target branch")
            test.Flow.Git("-C", test.Flow.Upstream, "checkout", "main")
            let policyPath = Path.Combine(test.Flow.Upstream, ".github/tokate.json")
            let policy = Check.Json(File.ReadAllText(policyPath))
            policy["target_branch"] = JsonValue.Create("release/next")
            File.WriteAllText(policyPath, policy.ToJsonString())
            test.Flow.Commit("Select target")
            using let baseline = FixtureSnapshot(test.Flow.Temp.Root)
            test.Flow.Approve()
            let expected = test.State()["state"]?["approval"] ?? throw Exception("Missing CLI approval")
            expected.AsObject().Remove("nonce")

            for level in[]string{"write", "maintain", "admin", "triage", "read", "none", "unknown", ""} {
                baseline.Restore()
                test.Flow.Reload()
                test.Flow.State["repo_permissions"] = Check.Json("{}")
                test.Flow.State["collaborator_permissions"] = Check.Map(
                    "donor",
                    Check.Map("permission", level, "role_name", "admin", "user", Check.Map("id", 123, "login", "donor"))
                )
                test.Flow.Save()
                let path = test.LabelEvent(123, "donor")
                test.Coordinate(path)
                test.Flow.Reload()
                let allowed = level == "write" || level == "maintain" || level == "admin"
                if allowed {
                    let actual = test.State()["state"]?["approval"] ?? throw Exception("Missing label approval")
                    actual.AsObject().Remove("nonce")
                    Check.That(
                        Check.FixtureDigest(actual) == Check.FixtureDigest(expected),
                        "Label approval differs from CLI approval"
                    )
                    Check.That(test.Flow.State["request_count"] == nil, "Authorized label posted a comment")
                    test.Flow.Temp.Env["GITHUB_EVENT_NAME"] = "issue_comment"
                    test.Claim()
                } else {
                    Check.That(
                        test.Flow.Git(
                            "-C",
                            test.Flow.Upstream,
                            "for-each-ref",
                            "refs/heads/tokate/contributions/"
                        ) == "",
                        "Rejected label created approval state"
                    )
                    Check.That(
                        test.Flow.State["issue"]?["labels"]?.ToJsonString() == "[{\"name\":\"existing\"}]",
                        "Rejected label removed unrelated labels or kept approval"
                    )
                    Check.Contains(
                        Check.Text(test.Flow.State["posted_request"]?["body"]),
                        "write, maintain or admin permission"
                    )
                    Check.That(
                        Check.Text(test.Flow.State["request_count"]) == "1",
                        "Rejected label did not post one explanation"
                    )
                    test.Coordinate(path)
                    test.Flow.Reload()
                    Check.That(
                        Check.Text(test.Flow.State["request_count"]) == "1",
                        "Rejected label replay repeated its comment"
                    )
                }
                test.Flow.NoPr()
                test.Flow.NoInference()
                test.Flow.AutomationAttribution()
            }
        }

        internal func LabelApprovalLifecycle(binary string) {
            using let test = CoordinationFixture(binary)
            test.Initialize(approve: false)
            test.Flow.OwnerAccess()
            test.Flow.Call([]string{"approve", "owner/project#1", "donor", "--yes"}, owner: true)
            let approved = test.State()
            let pending = test.ClaimRequest()
            let pendingPath = test.Event(pending)
            File.WriteAllText(Path.Combine(test.Flow.Upstream, "target.txt"), "Updated target.\n")
            test.Flow.Commit("Advance target before label approval")
            test.Coordinate(test.LabelEvent())
            let unchanged = test.State()
            Check.That(
                Check.FixtureDigest(unchanged) == Check.FixtureDigest(approved),
                "Label event replaced the named donor approval after the target moved"
            )
            Check.That(
                Check.Text(unchanged["state"]?["approval_id"]) == Check.Text(approved["state"]?["approval_id"]) &&
                    unchanged["state"]?["approval"]?["allowed_actor_ids"]?.ToJsonString() == "[123]",
                "Label event changed the approval ID or named donor"
            )
            Check.That(
                test.State()["state"]?["reservation"] == nil,
                "Label event processed a request from a different comment"
            )
            test.Flow.Temp.Env["GITHUB_EVENT_NAME"] = "issue_comment"
            test.Coordinate(pendingPath)
            Check.That(
                Check.Text(test.State()["state"]?["reservation"]?["actor"]) == "123",
                "Named donor could not claim after the label event"
            )
            let initial = test.State()
            let path = test.LabelEvent()
            test.Coordinate(path)
            test.Coordinate(path)
            Check.That(
                Check.FixtureDigest(test.State()) == Check.FixtureDigest(initial),
                "Label event reset a current approval or reservation"
            )

            File.WriteAllText(Path.Combine(test.Flow.Upstream, "target.txt"), "Updated target again.\n")
            test.Flow.Commit("Advance target")
            test.Coordinate(test.LabelEvent())
            let advanced = test.State()
            Check.That(
                Check.FixtureDigest(advanced) == Check.FixtureDigest(initial),
                "Label event reset a current approval or reservation after the target moved"
            )
            test.Coordinate(path)
            Check.That(
                Check.FixtureDigest(test.State()) == Check.FixtureDigest(advanced),
                "Label replay replaced the current target approval"
            )

            let policyPath = Path.Combine(test.Flow.Upstream, ".github/tokate.json")
            let policy = Check.Json(File.ReadAllText(policyPath))
            policy["max_seconds"] = JsonValue.Create(1800)
            File.WriteAllText(policyPath, policy.ToJsonString())
            test.Flow.Commit("Change task policy")
            test.Coordinate(test.LabelEvent())
            let refreshed = test.State()
            Check.That(
                Check.Text(refreshed["state"]?["approval_id"]) != Check.Text(initial["state"]?["approval_id"]),
                "Label did not refresh stale approval"
            )
            Check.That(refreshed["state"]?["reservation"] == nil, "Fresh approval kept a stale reservation")
            Check.That(
                Check.Text(refreshed["state"]?["approval"]?["base"]) == test.Flow.Git(
                    "-C",
                    test.Flow.Upstream,
                    "rev-parse",
                    "main"
                ),
                "Label approval did not capture the current target"
            )
            test.Coordinate(path)
            Check.That(
                Check.FixtureDigest(test.State()) == Check.FixtureDigest(refreshed),
                "Label replay replaced a fresh approval"
            )

            test.Flow.Call([]string{"revoke", "owner/project#1"}, owner: true)
            test.Coordinate(test.LabelEvent())
            Check.That(
                Check.Text(test.State()["state"]?["revoked"]) == "false",
                "Label did not replace revoked approval"
            )
            test.Flow.Temp.Env["GITHUB_EVENT_NAME"] = "issue_comment"
            test.Claim()
            test.Flow.Git("-C", test.Flow.Upstream, "branch", "release/next")
            test.Flow.Call(
                []string{
                    "approve",
                    "owner/project#1",
                    "donor",
                    "--base-branch",
                    "release/next",
                    "--yes",
                    "--non-interactive"
                },
                owner: true
            )
            let selected = test.State()
            test.Coordinate(test.LabelEvent())
            let labeled = test.State()
            Check.That(
                Check.FixtureDigest(labeled) == Check.FixtureDigest(selected),
                "Label event changed a CLI approval with a selected base branch"
            )
            Check.That(
                Check.Text(labeled["state"]?["approval"]?["base_branch"]) == "release/next",
                "Label event replaced the selected base branch"
            )
            Check.That(
                Check.Text(labeled["state"]?["approval"]?["allowed_actor_ids"]?[0]) == "123",
                "Label event removed the donor bound by CLI approval"
            )
            test.Flow.NoPr()
            test.Flow.NoInference()
            test.Flow.AutomationAttribution()
        }

        internal func LabelApprovalSafety(binary string) {
            using let test = CoordinationFixture(binary)
            test.Initialize(approve: false)
            test.Flow.OwnerAccess()
            let path = test.LabelEvent()
            let original = File.ReadAllText(path)
            test.Flow.ResetTraffic()
            using let baseline = FixtureSnapshot(test.Flow.Temp.Root)
            for fault in[]string{
                "event-name",
                "action",
                "label",
                "repo-name",
                "repo-id",
                "issue-id",
                "issue-number",
                "pull-event",
                "pull-live",
                "sender-id",
                "sender-login",
                "closed",
                "permission-api",
                "missing-label"
            } {
                baseline.Restore()
                test.Flow.Reload()
                test.Flow.Temp.Env["GITHUB_EVENT_NAME"] = fault == "event-name" ? "pull_request_target": "issues"
                let event = Check.Json(original)
                let issue = test.Flow.State["issue"] ?? throw Exception("Missing issue")
                switch fault {
                    case "action" {
                        event["action"] = JsonValue.Create("unlabeled")
                    }
                    case "label" {
                        (event["label"] ?? throw Exception("Missing label"))["name"] = JsonValue.Create("other")
                    }
                    case "repo-name" {
                        (event["repository"] ?? throw Exception("Missing repo"))["full_name"] = JsonValue.Create(
                            "other/project"
                        )
                    }
                    case "repo-id" {
                        (event["repository"] ?? throw Exception("Missing repo"))["id"] = JsonValue.Create(2)
                    }
                    case "issue-id" {
                        (event["issue"] ?? throw Exception("Missing issue"))["id"] = JsonValue.Create(102)
                    }
                    case "issue-number" {
                        (event["issue"] ?? throw Exception("Missing issue"))["number"] = JsonValue.Create(0)
                    }
                    case "pull-event" {
                        (event["issue"] ?? throw Exception("Missing issue"))["pull_request"] = Check.Json("{}")
                    }
                    case "pull-live" {
                        issue["pull_request"] = Check.Json("{}")
                    }
                    case "sender-id" {
                        (event["sender"] ?? throw Exception("Missing sender"))["id"] = JsonValue.Create(123)
                    }
                    case "sender-login" {
                        test.Flow.State["collaborator_permissions"] = Check.Map(
                            "owner",
                            Check.Map("permission", "admin", "user", Check.Map("id", 1, "login", "other"))
                        )
                    }
                    case "closed" {
                        issue["state"] = JsonValue.Create("closed")
                    }
                    case "missing-label" {
                        issue["labels"] = Check.Json("[{\"name\":\"existing\"}]")
                    }
                }
                test.Flow.Save()
                if fault == "permission-api" {
                    test.Flow.Faults(
                        "repos/owner/project/collaborators/owner/permission",
                        Check.Json("[{\"status\":403}]")
                    )
                }
                File.WriteAllText(path, event.ToJsonString())
                test.Coordinate(path, fault == "missing-label" ? 0: 1)
                test.Flow.Reload()
                Check.That(test.Flow.State["request_count"] == nil, "Invalid event posted a comment")
                Check.That(
                    test.Flow.Git("-C", test.Flow.Upstream, "for-each-ref", "refs/heads/tokate/contributions/") == "",
                    "Invalid event created approval state"
                )
                for call in test.Flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                    Check.That(Check.Text(call["method"]) == "GET", "Invalid event changed GitHub state")
                }
                test.Flow.NoPr()
                test.Flow.NoInference()
            }
            baseline.Restore()
            test.Flow.Git("-C", test.Flow.Upstream, "update-ref", "-d", "refs/heads/tokate/access")
            test.Coordinate(test.LabelEvent())
            Check.That(test.State()["state"]?["approval"] != nil, "Missing access ref blocked label approval")
        }
    }
}
