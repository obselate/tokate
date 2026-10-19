package TokateTests

import System
import System.Collections.Generic
import System.Text.Json.Nodes

internal partial class CoordinationFlow {
    shared {
        internal func HiddenStateRefs(binary string) {
            using let test = CoordinationFixture(binary)
            test.Initialize()
            let flow = test.Flow
            Check.That(
                flow.Git("-C", flow.Upstream, "for-each-ref", "refs/heads/tokate/") == "",
                "New state created branches"
            )
            let approved = test.State()
            let request = test.ClaimRequest()
            let access = flow.Git("-C", flow.Upstream, "rev-parse", "refs/tokate/access")
            for name in[]string{"tokate/access", "tokate/contributions/1"} {
                let sha = flow.Git("-C", flow.Upstream, "rev-parse", "refs/" + name)
                flow.Git("-C", flow.Upstream, "update-ref", "refs/heads/" + name, sha)
                flow.Git("-C", flow.Upstream, "update-ref", "-d", "refs/" + name)
            }
            let listed = Check.Envelope(
                flow.Call([]string{"access", "list", "owner/project", "--json"}),
                "access",
                "ok"
            )
            Check.That(
                Check.Text(listed["data"]?["access_sha"]) == access && listed["data"]?["members"]?.AsArray().Count == 2,
                "Legacy access read lost membership"
            )
            let status = Check.Envelope(flow.Call([]string{"status", "owner/project#1", "--json"}), "status", "ok")
            Check.That(
                Check.Text(status["data"]?["work"]?[0]?["approval_status"]) == "current" && Check.Text(
                    status["data"]?["work"]?[0]?["remote_status"]
                ) == "observed",
                "Legacy status did not observe current authority"
            )
            let path = test.Event(request)
            flow.Faults("graphql", Check.Json("[{\"status\":500},{\"status\":500},{\"status\":500}]"))
            test.Coordinate(path, 1)
            Check.That(
                flow.Git("-C", flow.Upstream, "for-each-ref", "refs/tokate/") == "" && flow.Git(
                    "-C",
                    flow.Upstream,
                    "rev-parse",
                    "refs/heads/tokate/contributions/1"
                ) == Check.Text(approved["sha"]),
                "Failed migration changed state refs"
            )
            flow.Faults("repos/owner/project/git/matching-refs/heads/tokate/", JsonArray(Check.Map("status", 403)))
            approved["sha"] = JsonValue.Create(LegacyRefConflict(test, path, Check.Text(approved["sha"])))
            flow.Faults("", JsonArray())
            flow.Mode("lost_state_response")
            request["expected"] = JsonValue.Create(Check.Text(approved["sha"]))
            test.Coordinate(test.Event(request))
            let migrated = test.State()
            Check.That(
                Check.Text(migrated["state"]?["approval_id"]) == Check.Text(approved["state"]?["approval_id"]),
                "Migration changed approval identity"
            )
            Check.That(
                flow.Git("-C", flow.Upstream, "rev-parse", Check.Text(migrated["sha"]) + "^") == Check.Text(
                    approved["sha"]
                ),
                "Migration lost state history"
            )
            Check.That(
                flow.Git("-C", flow.Upstream, "for-each-ref", "refs/heads/tokate/contributions/") == "",
                "Migration kept the contribution branch"
            )
            flow.Mode("lost_access_response")
            flow.Call([]string{"access", "trust", "other", "owner/project", "--yes"}, owner: true)
            Check.That(
                flow.Git("-C", flow.Upstream, "for-each-ref", "refs/heads/tokate/") == "",
                "Migration kept a state branch"
            )
            let current = Check.Json(flow.Git("-C", flow.Upstream, "show", "refs/tokate/access:access.json"))
            Check.That(
                current["members"]?.AsArray().Count == 3 && flow.Git(
                    "-C",
                    flow.Upstream,
                    "rev-parse",
                    "refs/tokate/access^"
                ) == access,
                "Migration lost access membership or history"
            )
            let main = flow.Git("-C", flow.Upstream, "rev-parse", "main")
            for name in[]string{"tokate/access", "tokate/contributions/1"} {
                flow.Git("-C", flow.Upstream, "update-ref", "refs/heads/" + name, main)
            }
            flow.Call([]string{"access", "check", "owner/project#1"})
            let observed = Check.Envelope(flow.Call([]string{"status", "owner/project#1", "--json"}), "status", "ok")
            Check.That(
                Check.Text(observed["data"]?["work"]?[0]?["remote_status"]) == "observed",
                "Legacy branches overrode hidden state"
            )
            flow.Approve()
            Check.That(test.State()["state"]?["reservation"] == nil, "Owner reapproval did not use hidden state")
            flow.NoInference()
            flow.NoPr()
        }

        private func LegacyRefConflict(test CoordinationFixture, path string, previous string) string {
            let flow = test.Flow
            let legacy = "refs/heads/tokate/contributions/1"
            let newer = flow.Git(
                "-C",
                flow.Upstream,
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit-tree",
                flow.Git("-C", flow.Upstream, "rev-parse", legacy + "^{tree}"),
                "-p",
                previous,
                "-m",
                "Concurrent legacy write"
            )
            flow.Reload()
            flow.State["ref_conflict_sha"] = JsonValue.Create(newer)
            flow.Save()

            Check.Contains(test.Coordinate(path, 1).Error, "Coordination changed")
            Check.That(
                flow.Git("-C", flow.Upstream, "rev-parse", legacy) == newer && flow.Git(
                    "-C",
                    flow.Upstream,
                    "for-each-ref",
                    "refs/tokate/contributions/"
                ) == "",
                "Migration lost a concurrent legacy write"
            )

            return newer
        }

        internal func HiddenRefConflicts(binary string) {
            using let test = CoordinationFixture(binary)
            test.Initialize()
            let flow = test.Flow
            let previous = Check.Text(test.State()["sha"])
            flow.Approve()
            let request = test.ClaimRequest()
            flow.Reload()
            flow.State["ref_conflict_sha"] = JsonValue.Create(previous)
            flow.Save()
            flow.ResetTraffic()
            Check.Contains(test.Coordinate(test.Event(request), 1).Error, "Coordination changed")
            Check.That(
                Check.Text(test.State()["sha"]) == previous && test.State()["state"]?["reservation"] == nil,
                "Stale fast-forward write replaced concurrent state"
            )
            flow.Reload()
            var rejected int32
            for call in flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                if Check.Text(call["path"]) == "graphql" {
                    rejected++
                    Check.That(
                        Check.Text(call["status"]) == "200" && Check.Text(call["conflict"]) == "true",
                        "Stale ref did not fail with a GraphQL error"
                    )
                }
            }
            Check.That(rejected == 1, "Stale GraphQL mutation was retried")
            flow.Mode("lost_state_response")
            flow.ResetTraffic()
            let retry = test.ClaimRequest()
            test.Coordinate(test.Event(retry))
            Check.That(
                Check.Text(test.State()["state"]?["reservation"]?["reservation"]) == Check.Text(retry["uuid"]),
                "Lost response did not preserve the successful write"
            )
            flow.Reload()
            var writes int32
            for call in flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                if Check.Text(call["path"]) == "graphql" {
                    writes++
                }
            }
            Check.That(writes == 1, "Lost mutation response was retried")
            flow.NoInference()
            flow.NoPr()
        }

        internal func LegacyRefCleanup(binary string) {
            using let test = CoordinationFixture(binary)
            test.Initialize()
            let flow = test.Flow
            let original = Check.Text(test.State()["sha"])
            flow.Approve()
            let current = Check.Text(test.State()["sha"])
            let access = flow.Git("-C", flow.Upstream, "rev-parse", "refs/tokate/access")
            flow.Git("-C", flow.Upstream, "update-ref", "refs/heads/tokate/access", access)
            flow.Git("-C", flow.Upstream, "update-ref", "-d", "refs/tokate/access")
            flow.Git("-C", flow.Upstream, "update-ref", "-d", "refs/tokate/contributions/1")
            flow.Git("-C", flow.Upstream, "update-ref", "refs/tokate/contributions/2", current)
            for number in 1 ... 26 {
                flow.Git(
                    "-C",
                    flow.Upstream,
                    "update-ref",
                    "refs/heads/tokate/contributions/" + number.ToString(),
                    original
                )
            }
            let other = []string{
                "tokate/v2-donor",
                "tokate/access-other",
                "tokate/access_extra/more",
                "tokate/contributions/x",
                "tokate/contributions/2-extra",
                "tokate/contributions/30/more",
                "other"
            }
            for name in other {
                flow.Git("-C", flow.Upstream, "update-ref", "refs/heads/" + name, current)
            }
            let path = test.LabelEvent()
            flow.Reload()
            let issue = flow.State["issue"] ?? throw Exception("Missing issue")
            issue["state"] = JsonValue.Create("closed")
            issue["labels"] = JsonArray()
            let issues = Check.Map("1", issue.DeepClone())
            for number in 2 ... 26 {
                issues[number.ToString()] = Check.Map("number", number, "state", "closed")
            }
            flow.State["issues"] = issues
            flow.Save()
            for pass in 0 ... 2 {
                flow.ResetTraffic()
                Check.Contains(test.Coordinate(path).Output, "Approval label is no longer present")
                flow.Reload()
                var moves int32
                var sweeping bool
                for call in flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                    if Check.Text(call["path"]) == "repos/owner/project/git/matching-refs/heads/tokate/" {
                        sweeping = true
                    }
                    if Check.Text(call["method"]) == "GET" {
                        continue
                    }
                    Check.That(sweeping && Check.Text(call["path"]) == "graphql", "Cleanup ran before coordinator work")
                    let updates = call["updates"]?.AsArray() ?? throw Exception("Missing ref updates")
                    let deletion = updates[updates.Count - 1] ?? throw Exception("Missing branch deletion")
                    Check.That(
                        Check.Text(deletion["beforeOid"]) == (
                            Check.Text(deletion["name"]).EndsWith("/access") ? access: original
                        ) &&
                            Check.Text(deletion["afterOid"]) == String('0', 40),
                        "Cleanup did not conditionally delete the legacy SHA"
                    )
                    if Check.Text(deletion["name"]) == "refs/heads/tokate/contributions/2" {
                        Check.That(updates.Count == 1, "Cleanup rewrote existing hidden state")
                    } else {
                        Check.That(
                            updates.Count == 2 && Check.Text(updates[0]?["beforeOid"]) == String('0', 40) && Check.Text(
                                updates[0]?["afterOid"]
                            ) == Check.Text(deletion["beforeOid"]),
                            "Cleanup did not atomically preserve the legacy SHA"
                        )
                    }
                    moves++
                }
                Check.That(moves == (pass == 0 ? 20: 6), "Cleanup did not bound or continue its work")
            }
            Check.That(
                flow.Git("-C", flow.Upstream, "rev-parse", "refs/tokate/access") == access,
                "Cleanup changed access state"
            )
            for number in 1 ... 26 {
                let reference = "refs/tokate/contributions/" + number.ToString()
                Check.That(
                    flow.Git("-C", flow.Upstream, "rev-parse", reference) == (number == 2 ? current: original) &&
                        flow.Git("-C", flow.Upstream, "show", reference + ":state.json") == flow.Git(
                        "-C",
                        flow.Upstream,
                        "show",
                        (number == 2 ? current: original) + ":state.json"
                    ),
                    "Cleanup changed a closed issue record"
                )
            }
            let expected = List[string]{"refs/heads/main"}
            for name in other {
                expected.Add("refs/heads/" + name)
                Check.That(
                    flow.Git("-C", flow.Upstream, "rev-parse", "refs/heads/" + name) == current,
                    "Cleanup changed another branch"
                )
            }
            expected.Sort(StringComparer.Ordinal)
            Check.That(
                flow.Git("-C", flow.Upstream, "for-each-ref", "--format=%(refname)", "refs/heads/") == String.Join(
                    "\n",
                    expected
                ),
                "Cleanup kept a legacy branch or removed another branch"
            )
            Check.Contains(flow.Call([]string{"access", "check", "owner/project#1"}, 1).Error, "is closed")
            flow.NoInference()
            flow.NoPr()
        }

        internal func LegacyRefCleanupFailures(binary string) {
            using let test = CoordinationFixture(binary)
            test.Initialize()
            let flow = test.Flow
            let request = test.ClaimRequest()
            let path = test.Event(request)
            test.Coordinate(path)
            let outcome = test.Coordinate(path)
            let state = Check.Text(test.State()["sha"])
            let legacy = "refs/heads/tokate/contributions/2"
            let hidden = "refs/tokate/contributions/2"
            flow.Git("-C", flow.Upstream, "update-ref", legacy, state)
            for endpoint in[]string{
                "repos/owner/project/git/matching-refs/heads/tokate/",
                "repos/owner/project/git/ref/tokate/contributions/2",
                "graphql"
            } {
                flow.Faults(endpoint, JsonArray(Check.Map("status", 403)))
                let replay = test.Coordinate(path)
                Check.That(replay.Output == outcome.Output, "Cleanup failure changed the request outcome")
                Check.That(
                    flow.Git("-C", flow.Upstream, "rev-parse", legacy) == state && flow.Git(
                        "-C",
                        flow.Upstream,
                        "for-each-ref",
                        hidden
                    ) == "" &&
                        Check.Text(test.State()["sha"]) == state,
                    "Failed cleanup changed state"
                )
            }
            flow.Faults("", JsonArray())
            let newer = flow.Git("-C", flow.Upstream, "rev-parse", state + "^")
            flow.Reload()
            flow.State["ref_conflict_sha"] = JsonValue.Create(newer)
            flow.Save()
            Check.That(test.Coordinate(path).Output == outcome.Output, "Cleanup conflict changed the request outcome")
            Check.That(
                flow.Git("-C", flow.Upstream, "rev-parse", legacy) == newer && flow.Git(
                    "-C",
                    flow.Upstream,
                    "for-each-ref",
                    hidden
                ) == "",
                "Cleanup lost a concurrent legacy write or created stale hidden state"
            )
            flow.Faults("graphql", JsonArray(Check.Map("status", 403)))
            let invalid = request.DeepClone()
            invalid["expected"] = JsonValue.Create(state)
            let failure = test.Coordinate(test.Event(invalid), 1)
            Check.Contains(failure.Error, "UUID replay changed")
            Check.That(
                flow.Git("-C", flow.Upstream, "rev-parse", legacy) == newer,
                "Failed run cleanup changed the branch"
            )
            flow.Faults("", JsonArray())
            Check.Contains(test.Coordinate(test.Event(invalid), 1).Error, "UUID replay changed")
            Check.That(
                flow.Git("-C", flow.Upstream, "for-each-ref", legacy) == "" && flow.Git(
                    "-C",
                    flow.Upstream,
                    "rev-parse",
                    hidden
                ) == newer &&
                    Check.Text(test.State()["sha"]) == state,
                "Later cleanup did not preserve the concurrent value"
            )
            flow.NoInference()
            flow.NoPr()
        }
    }
}
