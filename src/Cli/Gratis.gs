package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Linq
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

internal class Gratis {
    shared {
        internal func PolicyFor(args Args) Policy {
            DonorDefaults.NormalizePair(args)
            let policy = Data.From(J.Parse(ApplicationInfo.Resource("tokate.json")))
            policy.Fields["max_seconds"] = 86400
            policy.Fields["verification"] = []Object{}
            policy.Fields["required_checks"] = []Object{}
            policy.Fields["allowed_tools"] = []Object{
                map[string, Object?]{
                    "harness": args.Get("harness", "codex"),
                    "provider": args.Get("provider", "openai")
                }
            }
            return Policy(J.Write(policy.Fields), gratis: true)
        }

        private func Require(valid bool, message string) {
            if !valid {
                throw CliFailure("invalid_state", message)
            }
        }

        private func Query(repo string, query string, variables Dictionary[string, Object?]? = nil) JsonElement {
            let input = variables ?? map[string, Object?]{}
            input["owner"] = repo.Split('/')[0]
            input["name"] = repo.Split('/')[1]
            let result = GitHub.Api("graphql", map[string, Object?]{"query": query, "variables": input})
            Require(J.Count(J.Get(result, "errors")) == 0, "Gratis GraphQL query failed")
            return J.Get(result, "data")
        }

        internal func Snapshot(repo string) List[Object] {
            let pulls = List[Object]()
            var cursor string? = nil
            while true {
                var filesCursor string? = nil
                var issuesCursor string? = nil
                let files = HashSet[string]()
                let issues = HashSet[int32]()
                var connection JsonElement
                var pull JsonElement
                var number int32
                while true {
                    let result = Query(
                        repo,
                        "query($$owner:String!,$$name:String!,$$cursor:String,$$files:String,$$issues:String){repository(owner:$$owner,name:$$name){pullRequests(states:OPEN,first:1,after:$$cursor,orderBy:{field:CREATED_AT,direction:ASC}){nodes{number title body closingIssuesReferences(first:100,after:$$issues){nodes{number repository{nameWithOwner}} pageInfo{hasNextPage endCursor}} files(first:100,after:$$files){nodes{path} pageInfo{hasNextPage endCursor}}} pageInfo{hasNextPage endCursor}}}}",
                        map[string, Object?]{"cursor": cursor, "files": filesCursor, "issues": issuesCursor}
                    )
                    connection = J.Get(J.Get(result, "repository"), "pullRequests")
                    Require(connection.ValueKind == JsonValueKind.Object, "Open PR snapshot is unavailable")
                    let nodes = J.Items(J.Get(connection, "nodes"))
                    if nodes.Count == 0 {
                        return pulls
                    }
                    pull = nodes[0]
                    Require(number == 0 || number == J.Number(pull, "number"), "Open PR snapshot changed during paging")
                    number = J.Number(pull, "number")
                    let changed = J.Get(pull, "files")
                    let linked = J.Get(pull, "closingIssuesReferences")
                    files.UnionWith(J.Items(J.Get(changed, "nodes")).Select(file -> J.Text(file, "path")))
                    issues.UnionWith(
                        J
                            .Items(J.Get(linked, "nodes"))
                            .Where(
                            issue -> RepositoryIdentity.SameRepo(
                                J.Text(J.Get(issue, "repository"), "nameWithOwner"),
                                repo
                            )
                        )
                            .Select(issue -> J.Number(issue, "number"))
                    )
                    let moreFiles = J.Bool(J.Get(changed, "pageInfo"), "hasNextPage")
                    let moreIssues = J.Bool(J.Get(linked, "pageInfo"), "hasNextPage")
                    if !moreFiles && !moreIssues {
                        break
                    }
                    filesCursor = moreFiles ? J.Text(J.Get(changed, "pageInfo"), "endCursor"): filesCursor
                    issuesCursor = moreIssues ? J.Text(J.Get(linked, "pageInfo"), "endCursor"): issuesCursor
                }
                pulls.Add(
                    map[string, Object?]{
                        "number": J.Number(pull, "number"),
                        "title": J.Text(pull, "title"),
                        "body": J.Text(pull, "body"),
                        "issues": List[int32](issues),
                        "files": List[string](files)
                    }
                )
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
            Require(Encoding.UTF8.GetByteCount(J.Write(record)) <= 65536, "Guidance and PR snapshot exceed 64 KiB")
            record["pulls"] = original
            return J.Parse(J.Write(record))
        }

        private func Artifact(checkout string, name string) string {
            let path = Path.Combine(checkout, name)
            if !File.Exists(path) && FileInfo(path).LinkTarget == nil {
                return ""
            }
            let tracked = Commands.Git(checkout, "ls-files", "--", name)
            let file = FileInfo(path)
            Require(file.LinkTarget == nil && file.Length <= 4096 && tracked == "", "Invalid gratis artifact")
            let text = File.ReadAllText(path).Trim()
            Require(text != "", "Gratis artifact is empty")
            File.Delete(path)
            return text
        }

        internal func Outcome(directory string, checkout string, run Data, budget RuntimeBudget) bool {
            let refusal = Artifact(checkout, "tokate-refusal.txt")
            if refusal != "" {
                run.Fields["state"] = "refused"
                run.Fields["refusal"] = refusal
            } else {
                let guidance = J.Get(J.Get(run.Element(), "gratis_context"), "guidance").EnumerateObject().MoveNext()
                run.Fields["ready"] = Artifact(checkout, "tokate-ready.txt") != "" && guidance
                let findings = Artifact(checkout, "tokate-findings.md")
                if findings != "" {
                    let safe = !Regex.IsMatch(findings, PublicSummary.RestrictedTextPattern)
                    Require(guidance && safe, "Findings lack guidance or contain restricted public text")
                    run.Fields["findings"] = findings
                }
                PublicSummary.Capture(directory, checkout, run)
                if budget.Git(checkout, "status", "--porcelain") != "" {
                    return false
                }
                run.Fields["state"] = "skipped"
            }
            run.Fields.Remove("failure_stage")
            run.Fields.Remove("failure_reason")
            run.Save(directory)
            return true
        }

        internal func Publish(directory string, run Data) {
            ContributionAuthority.Recheck(run)
            if run.Text("state") == "refused" {
                return
            }
            Require(run.Text("state") == "generated" || run.Text("state") == "skipped", "Task is not ready")
            let repoName = run.Text("repo")
            let donor = run.Text("donor")
            let id = run.Text("id")
            let head = run.Text("commit")
            let context = J.Get(run.Element(), "gratis_context")
            let tool = J.Select(run.Element(), "harness,provider,model,effort")
            tool["coding_seconds"] = run.Number("execution_seconds")
            tool["usage"] = J.Get(run.Element(), "usage")
            let receipt = ContributionReceipt.Coordinated(repoName, run.Number("issue"), "", "", id, donor, head)
            receipt["mode"] = "gratis"
            receipt["owner_approved"] = false
            receipt["tools"] = []Object{tool}
            receipt["verification"] = []Object{}
            receipt["prompt_sha256"] = J.Text(context, "prompt_sha256")
            let summary = head == "" ? J.Get(run.Element(), "public_summary"): PublicSummary.ForHead(run, head)
            PublicSummary.Attach(receipt, summary)
            let attribution = "Donated with [Tokate](https://github.com/obselate/tokate) by @" +
                donor +
                ". No owner approved the task. No repository check ran. Repository CI still applies." +
                PublicSummary.Tools(J.Parse(J.Write([]Object{tool})), "Donor-reported tools")
            let marker = "<!-- tokate-receipt:" + J.Write(receipt) + " -->"
            let report = PrBody.Report(PublicSummary.Report(summary, "No repository check ran."))
            let body = report + "\n\n" + attribution + "\n\n<!-- tokate-v2:" + id + " -->\n" + marker
            if run.Text("state") == "generated" {
                let checkout = Verification.Candidate(Path.Combine(directory, "checkout"))
                Require(Commands.Git(checkout, "rev-parse", "HEAD") == run.Text("commit"), "Verified head changed")
                Require(Commands.Git(checkout, "status", "--porcelain") == "", "Verified checkout changed")
                File.WriteAllText(Path.Combine(directory, "publication.json"), J.Write(receipt))
                Require(!run.Flag("publication_attempted"), "PR publication was already attempted")
                Publication.Push(checkout, run, run.Text("commit"))
                ContributionAuthority.Recheck(run)
                run.Fields["publication_attempted"] = true
                run.Save(directory)
                let pull = GitHub.Api(
                    "repos/" + repoName + "/pulls",
                    map[string, Object?]{
                        "title": J.Text(J.Get(context, "issue"), "title"),
                        "body": body,
                        "head": donor + ":" + run.Text("branch"),
                        "base": run.Text("base_branch"),
                        "draft": !run.Flag("ready"),
                        "maintainer_can_modify": false
                    }
                )
                Publication.SavePr(directory, run, pull)
            }
            let findings = run.Text("findings")
            Require(!Regex.IsMatch(findings, PublicSummary.RestrictedTextPattern), "Restricted findings text")
            if findings == "" {
                return
            }
            try {
                Require(!run.Flag("discussion_attempted"), "Discussion publication was already attempted")
                let result = Query(
                    repoName,
                    "query($$owner:String!,$$name:String!){repository(owner:$$owner,name:$$name){id discussionCategories(first:100){nodes{id name} pageInfo{hasNextPage}}}}"
                )
                let repo = J.Get(result, "repository")
                var category string = ""
                for entry in J.Items(J.Get(J.Get(repo, "discussionCategories"), "nodes")) {
                    if J.Text(entry, "name") == "General" {
                        category = J.Text(entry, "id")
                    }
                }
                Require(category != "", "General Discussion category is unavailable")
                run.Fields["discussion_attempted"] = true
                run.Save(directory)
                let input = map[string, Object?]{
                    "repo": J.Text(repo, "id"),
                    "category": category,
                    "title": "Tokate donation findings",
                    "body": findings + "\n\n" + attribution + "\n\n" + marker
                }
                let posted = Query(
                    repoName,
                    "mutation($$repo:ID!,$$category:ID!,$$title:String!,$$body:String!){createDiscussion(input:{repositoryId:$$repo,categoryId:$$category,title:$$title,body:$$body}){discussion{url}}}",
                    input
                )
                let url = J.Text(J.Get(J.Get(posted, "createDiscussion"), "discussion"), "url")
                Require(url != "", "Discussion publication failed")
                run.Fields["discussion_url"] = url
                run.Fields["state"] = "published"
            } catch (error Exception) when !(error is CommandInterrupted) {
                run.Fields["discussion_error"] = error.Message
                if run.Number("pr") == 0 {
                    throw error
                }
            } finally {
                run.Save(directory)
            }
        }
    }
}
