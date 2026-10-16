package Tokate

import System
import System.Collections.Generic
import System.Text
import System.Text.Json

internal class GitHub {
    shared {
        internal func Bot() Object -> map[string, Object?]{
            "name": "github-actions[bot]",
            "email": "41898282+github-actions[bot]@users.noreply.github.com"
        }

        internal func Author(viewer JsonElement) Object -> map[string, Object?]{
            "name": RepositoryIdentity.Login(J.Text(viewer, "login")),
            "email": RepositoryIdentity.Email(J.Get(viewer, "id"), J.Text(viewer, "login"))
        }

        internal func AutomationCommit(
            message string,
            tree string,
            parents IEnumerable[string],
            identity Object
        ) Object {
            return map[string, Object?]{
                "message": message,
                "tree": tree,
                "parents": parents,
                "author": identity,
                "committer": identity
            }
        }

        internal suspend func Api(
            path string,
            body Object? = nil,
            method string = "",
            missing bool = false,
            expires int64 = 0
        ) JsonElement -> ApiTransport.Request(path, body, method, missing, expires)

        internal func FileAt(repo string, path string, revision string = "", missing bool = false) string {
            let result = Api(
                "repos/" + repo + "/contents/" + path + (revision == "" ? "": "?ref=" + Uri.EscapeDataString(revision)),
                missing: missing
            )

            if result.ValueKind == JsonValueKind.Undefined {
                return ""
            }

            if J.Text(result, "encoding") != "base64" {
                throw Exception("Expected a small repository configuration file")
            }

            return Encoding.UTF8.GetString(Convert.FromBase64String(J.Text(result, "content")))
        }

        internal func Branch(repo string, branch string) string {
            let name = Uri.EscapeDataString(RepositoryIdentity.Branch(branch))
            let reference = Api("repos/" + repo + "/git/ref/heads/" + name, missing: true)
            if reference.ValueKind == JsonValueKind.Undefined {
                throw CliFailure("invalid_state", "Branch " + branch + " does not exist in " + repo + ".")
            }
            return RepositoryIdentity.CommitSha(J.Text(J.Get(reference, "object"), "sha"))
        }

        internal func Issue(repo string, number int32) JsonElement {
            let target = repo + "#" + number.ToString()
            let issue = Api("repos/" + repo + "/issues/" + number.ToString(), missing: true)
            if issue.ValueKind == JsonValueKind.Undefined {
                throw CliFailure("invalid_state", "Issue " + target + " does not exist.")
            }

            if J.Text(issue, "state") != "open" || J.Get(issue, "pull_request").ValueKind != JsonValueKind.Undefined {
                throw CliFailure(
                    "invalid_state",
                    target +
                        (
                        J.Get(issue, "pull_request")
                            .ValueKind != JsonValueKind.Undefined ? " is a pull request.": " is closed."
                    )
                )
            }

            return issue
        }

        internal func HasLabel(issue JsonElement) bool {
            for label in J.Items(J.Get(issue, "labels")) {
                if J.Text(label, "name") == "tokate:approved" {
                    return true
                }
            }

            return false
        }

        internal func Fingerprint(issue JsonElement) string -> Data.Hash(
            J.Write(map[string, Object?]{"title": J.Text(issue, "title"), "body": J.Text(issue, "body")})
        )
    }
}
