package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Linq
import System.Text
import System.Text.Json

internal class Gratis {
    shared {
        internal func PolicyFor(args Args) Policy {
            DonorDefaults.NormalizePair(args)
            let policy = map[string, Object?]{}

            for field in J.Parse(ApplicationInfo.Resource("tokate.json")).EnumerateObject() {
                policy[field.Name] = field.Value.Clone()
            }

            policy["max_seconds"] = 86400
            policy["verification"] = []Object{}
            policy["required_checks"] = []Object{}
            policy["allowed_tools"] = []Object{
                map[string, Object?]{
                    "harness": args.Get("harness", "codex"),
                    "provider": args.Get("provider", "openai")
                }
            }
            return Policy(J.Write(policy))
        }

        internal func ConfirmPublish(
            directory string,
            args Args,
            preview Dictionary[string, Object?],
            consent string
        ) bool {
            PublicOutput.ResultData = preview
            Terminal.Message(Output.Clean(consent), error: true)

            if OwnerSetup.Confirm(args, "Publish this contribution?") {
                return true
            }

            if OwnerSetup.Unattended(args) {
                PublicOutput.Actions.Add([]string{"tokate", "submit", "--run", directory, "--yes"})
                return false
            }

            throw CliFailure("confirmation_required", "Gratis submission requires --yes. Nothing changed.")
        }

        internal func Snapshot(repo string) List[Object] {
            let pulls = List[Object]()
            var cursor string? = nil
            while true {
                let result = Publication.Query(
                    repo,
                    "query($$owner:String!,$$name:String!,$$cursor:String){repository(owner:$$owner,name:$$name){pullRequests(states:OPEN,first:50,after:$$cursor,orderBy:{field:CREATED_AT,direction:ASC}){nodes{number title body closingIssuesReferences(first:20){nodes{number repository{nameWithOwner}}} files(first:100){nodes{path}}} pageInfo{hasNextPage endCursor}}}}",
                    map[string, Object?]{"cursor": cursor}
                )
                let connection = J.Get(J.Get(result, "repository"), "pullRequests")
                Publication.Require(connection.ValueKind == JsonValueKind.Object, "Open PR snapshot is unavailable")
                for pull in J.Items(J.Get(connection, "nodes")) {
                    pulls.Add(
                        map[string, Object?]{
                            "number": J.Number(pull, "number"),
                            "title": J.Text(pull, "title"),
                            "body": J.Text(pull, "body"),
                            "issues": J
                                .Items(J.Get(J.Get(pull, "closingIssuesReferences"), "nodes"))
                                .Where(
                                issue -> RepositoryIdentity.SameRepo(
                                    J.Text(J.Get(issue, "repository"), "nameWithOwner"),
                                    repo
                                )
                            )
                                .Select(issue -> J.Number(issue, "number"))
                                .ToList(),
                            "files": J
                                .Items(J.Get(J.Get(pull, "files"), "nodes"))
                                .Select(file -> J.Text(file, "path"))
                                .ToList()
                        }
                    )
                }
                if !J.Bool(J.Get(connection, "pageInfo"), "hasNextPage") {
                    return pulls
                }
                cursor = J.Text(J.Get(connection, "pageInfo"), "endCursor")
            }
        }

        internal func Context(record Dictionary[string, Object?], pulls List[Object]) JsonElement {
            record.Remove("pulls")
            let original = J.Parse(J.Write(pulls))
            let bounded = pulls.Cast[Dictionary[string, Object?]]().ToList()
            record["snapshot"] = bounded
            if Encoding.UTF8.GetByteCount(J.Write(record)) > 65536 {
                for item in bounded {
                    item["body"] = ""
                }
            }
            while Encoding.UTF8.GetByteCount(J.Write(record)) > 65536 && bounded.Count > 0 {
                bounded.RemoveAt(bounded.Count - 1)
            }
            if record.ContainsKey("issue") {
                let issue = J.Select(J.Parse(J.Write(record["issue"])), "number,title,body")
                record["issue"] = issue
                var body = issue.GetValueOrDefault("body")?.ToString() ?? ""
                while Encoding.UTF8.GetByteCount(J.Write(record)) > 65536 && body != "" {
                    body = body.Substring(0, body.Length / 2)
                    issue["body"] = body
                }
            }
            Publication.Require(
                Encoding.UTF8.GetByteCount(J.Write(record)) <= 65536,
                "Guidance and PR snapshot exceed 64 KiB"
            )
            record["pulls"] = original
            return J.Parse(J.Write(record))
        }
    }
}
