package Tokate

import System
import System.Collections.Generic
import System.Text.Json
import System.Text.RegularExpressions

internal class StateRefs {
    shared {
        private const ZeroOid string = "0000000000000000000000000000000000000000"

        internal func Read(repo string, name string) JsonElement {
            let reference = GitHub.Api("repos/" + repo + "/git/ref/" + name, missing: true)
            return reference.ValueKind != JsonValueKind.Undefined ? reference:
            GitHub.Api("repos/" + repo + "/git/ref/heads/" + name, missing: true)
        }

        internal func Matching(repo string, prefix string) List[JsonElement] {
            let result = List[JsonElement]()
            let hidden = HashSet[string](StringComparer.Ordinal)
            for namespace in[]string{"", "heads/"} {
                let references = GitHub.Api("repos/" + repo + "/git/matching-refs/" + namespace + prefix)
                if references.ValueKind != JsonValueKind.Array {
                    throw Exception("Cannot inspect canonical state references")
                }
                for reference in J.Items(references) {
                    let name = J.Text(reference, "ref")
                    if namespace == "" {
                        hidden.Add(name)
                    } else if hidden.Contains(name.Replace(GitHub.HeadsRefPrefix, "refs/")) {
                        continue
                    }
                    result.Add(reference)
                }
            }
            return result
        }

        internal func Update(
            repo string,
            name string,
            expected string,
            next string,
            expires int64 = 0,
            legacy bool = false
        ) {
            let updates = List[Object]{
                map[string, Object?]{
                    "name": "refs/" + name,
                    "beforeOid": legacy ? ZeroOid: expected,
                    "afterOid": next,
                    "force": false
                }
            }
            if legacy {
                updates.Add(
                    map[string, Object?]{
                        "name": GitHub.HeadsRefPrefix + name,
                        "beforeOid": expected,
                        "afterOid": ZeroOid,
                        "force": false
                    }
                )
            }

            Write(J.Text(GitHub.Api("repos/" + repo), "node_id"), updates, expires)
        }

        internal func MigrateLegacy(repo string) {
            let branches = GitHub.Api("repos/" + repo + "/git/matching-refs/heads/tokate/")
            var count int32
            var repositoryId string = ""
            for branch in J.Items(branches) {
                let name = J.Text(branch, "ref")
                if !Regex.IsMatch(name, "\\Arefs/heads/tokate/(access|contributions/[0-9]+)\\z") {
                    continue
                }
                if count++ == 20 {
                    break
                }
                try {
                    if repositoryId == "" {
                        repositoryId = J.Text(GitHub.Api("repos/" + repo), "node_id")
                    }
                    let hidden = name.Replace(GitHub.HeadsRefPrefix, "refs/")
                    let sha = RepositoryIdentity.CommitSha(J.Text(J.Get(branch, "object"), "sha"))
                    let updates = List[Object]()
                    let reference = GitHub.Api("repos/" + repo + "/git/ref/" + hidden.Substring(5), missing: true)
                    if reference.ValueKind == JsonValueKind.Undefined {
                        updates.Add(
                            map[string, Object?]{"name": hidden, "beforeOid": ZeroOid, "afterOid": sha, "force": false}
                        )
                    }
                    updates.Add(
                        map[string, Object?]{"name": name, "beforeOid": sha, "afterOid": ZeroOid, "force": false}
                    )
                    Write(repositoryId, updates)
                } catch { }
            }
        }

        private func Write(repositoryId string, updates List[Object], expires int64 = 0) {
            if repositoryId == "" {
                throw Exception("Missing repository node identity")
            }
            let result = GitHub.Api(
                "graphql",
                map[string, Object?]{
                    "query": "mutation($$input:UpdateRefsInput!){updateRefs(input:$$input){clientMutationId}}",
                    "variables": map[string, Object?]{
                        "input": map[string, Object?]{"repositoryId": repositoryId, "refUpdates": updates.ToArray()}
                    }
                },
                expires: expires
            )
            if J.Get(J.Get(result, "data"), "updateRefs").ValueKind != JsonValueKind.Object {
                throw CliFailure("command_failed", "GitHub state ref update failed. No automatic retry was made.")
            }
        }
    }
}
