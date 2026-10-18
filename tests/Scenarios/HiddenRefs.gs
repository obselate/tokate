package TokateTests

import System
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
            flow.Faults("repos/owner/project/git/refs", JsonArray(Check.Map("status", 500)))
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
            flow.Faults("", JsonArray())
            flow.Mode("lost_state_response")
            test.Coordinate(path)
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
    }
}
