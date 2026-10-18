package Tokate

import System
import System.Collections.Generic
import System.Text.Json

internal class StateRefs {
    shared {
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

        internal func Update(repo string, name string, expected string, next string, expires int64 = 0) {
            let repositoryId = J.Text(GitHub.Api("repos/" + repo), "node_id")
            if repositoryId == "" {
                throw Exception("Missing repository node identity")
            }
            let result = GitHub.Api(
                "graphql",
                map[string, Object?]{
                    "query": "mutation($$input:UpdateRefsInput!){updateRefs(input:$$input){clientMutationId}}",
                    "variables": map[string, Object?]{
                        "input": map[string, Object?]{
                            "repositoryId": repositoryId,
                            "refUpdates": []Object{
                                map[string, Object?]{
                                    "name": "refs/" + name,
                                    "beforeOid": expected,
                                    "afterOid": next,
                                    "force": false
                                }
                            }
                        }
                    }
                },
                expires: expires
            )
            if J.Get(J.Get(result, "data"), "updateRefs").ValueKind != JsonValueKind.Object {
                throw CliFailure("command_failed", "GitHub state ref update failed. No automatic retry was made.")
            }
        }

        internal func RemoveLegacy(repo string, name string) {
            GitHub.Api("repos/" + repo + "/git/refs/heads/" + name, method: "DELETE", missing: true)
        }
    }
}
