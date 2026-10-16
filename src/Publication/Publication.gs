package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class Publication {
    shared {
        internal func Query(repo string, query string, variables Dictionary[string, Object?]? = nil) JsonElement {
            let input = variables ?? map[string, Object?]{}
            input["owner"] = repo.Split('/')[0]
            input["name"] = repo.Split('/')[1]

            let result = GitHub.Api("graphql", map[string, Object?]{"query": query, "variables": input})
            Require(J.Count(J.Get(result, "errors")) == 0, "Gratis GraphQL query failed")

            return J.Get(result, "data")
        }

        internal func Require(valid bool, message string) {
            if !valid {
                throw CliFailure("invalid_state", message)
            }
        }

        internal func Push(checkout string, run Data, commit string) {
            Commands.Git(
                checkout,
                "-c",
                "credential.helper=",
                "-c",
                "credential.helper=!gh auth git-credential",
                "push",
                "https://github.com/" + run.Text("head_repo") + ".git",
                commit + ":refs/heads/" + run.Text("branch")
            )
        }

        internal func Pulls(run Data) List[JsonElement] {
            let pulls = List[JsonElement]()

            for page in 1 ... 21 {
                let response = GitHub.Api(
                    "repos/" + RepositoryIdentity.Repo(run.Text("repo")) +
                        "/pulls?state=all&head=" +
                        Uri.EscapeDataString(run.Text("donor") + ":" + run.Text("branch")) +
                        "&per_page=100&page=" +
                        page.ToString()
                )

                if response.ValueKind != JsonValueKind.Array {
                    throw CliFailure(
                        "invalid_state",
                        "interrupted_publication: matching PR history is invalid; refusing publication"
                    )
                }

                let rows = J.Items(response)
                pulls.AddRange(rows)

                if rows.Count < 100 {
                    return pulls
                }
            }

            throw CliFailure(
                "invalid_state",
                "interrupted_publication: matching PR history is incomplete; refusing publication"
            )
        }

        internal func Match(run Data, pull JsonElement, expectedReceipt JsonElement, newIntent bool = false) {
            let failure = "interrupted_publication: physical PR differs from exact saved run/head/receipt"
            let head = J.Get(pull, "head")
            let base = J.Get(pull, "base")
            let mergedAt = J.Get(pull, "merged_at").ValueKind
            if J.Text(head, "ref") != run.Text("branch") || !RepositoryIdentity.SameRepo(
                J.Text(J.Get(head, "repo"), "full_name"),
                run.Text("head_repo")
            ) ||
                J.Text(base, "ref") != run.Text("base_branch") || !RepositoryIdentity.SameRepo(
                J.Text(J.Get(base, "repo"), "full_name"),
                run.Text("repo")
            ) ||
                J.Text(pull, "state") != "open" || !J.Bool(pull, "draft") || J.Bool(pull, "merged") ||
                (mergedAt != JsonValueKind.Undefined && mergedAt != JsonValueKind.Null) ||
                J.Number(pull, "number") < 1 || J.Get(J.Get(pull, "user"), "id").ToString() != J.Get(
                run.Element(),
                "donor_id"
            )
                .ToString() {
                throw CliFailure("invalid_state", failure)
            }
            if newIntent {
                return
            }
            let marker = "<!-- tokate-v2:" + run.Text("id") + " -->"
            let body = J.Text(pull, "body")
            let receipt = RequestData.Parse(PrBody.ReceiptText(body, failure, failure))
            if !RepositoryIdentity.SameRepo(J.Text(receipt, "repo"), J.Text(expectedReceipt, "repo")) {
                throw CliFailure("invalid_state", failure)
            }
            let comparable = Dictionary[string, Object?]()
            for field in receipt.EnumerateObject() {
                comparable[field.Name] = field.Name == "repo" ? J.Text(expectedReceipt, "repo"): field.Value
            }
            if !RequestData.Same(J.Parse(J.Write(comparable)), expectedReceipt) || !body.Contains(marker) ||
                body.IndexOf(marker, StringComparison.Ordinal) != body.LastIndexOf(marker, StringComparison.Ordinal) ||
                J.Text(head, "sha") != J.Text(expectedReceipt, "head") {
                throw CliFailure("invalid_state", failure)
            }
        }

        internal func Find(run Data, expectedReceipt JsonElement, newIntent bool = false) JsonElement {
            let pulls = Pulls(run)

            if pulls.Count > 1 {
                throw CliFailure("invalid_state", "interrupted_publication: ambiguous physical PRs; intent preserved")
            }

            if pulls.Count == 0 {
                return JsonElement{}
            }

            Match(run, pulls[0], expectedReceipt, newIntent)

            return pulls[0]
        }

        internal func PullRequest(run Data, title string, body string, draft bool, maintainerEdits bool) Dictionary[
            string,
            Object?
        ] {
            let fields = map[string, Object?]{
                "title": title,
                "body": body,
                "head": run.Text("head_repo").Split('/')[0] + ":" + run.Text("branch"),
                "base": run.Text("base_branch"),
                "draft": draft
            }
            if !RepositoryIdentity.SameRepo(run.Text("head_repo"), run.Text("repo")) {
                fields["maintainer_can_modify"] = maintainerEdits
            }
            return fields
        }

        internal func Prepare(run Data, record JsonElement, request JsonElement, newIntent bool = false) JsonElement {
            let receipt = ContributionReceipt.Publication(
                run.Text("repo"),
                run.Number("issue"),
                request,
                run.Text("id"),
                run.Text("donor")
            )
            let body = PrBody.Coordinated(
                record,
                J.Get(request, "metadata"),
                run.Text("donor"),
                receipt,
                "<!-- tokate-v2:" + run.Text("id") + " -->"
            )
            RepositoryAccess.ValidateFork(
                run.Text("repo"),
                J.Get(request, "metadata"),
                J.Get(run.Element(), "donor_id")
            )
            let expected = J.Parse(J.Write(receipt))
            var pull = Find(run, expected, newIntent)
            if pull.ValueKind == JsonValueKind.Undefined {
                pull = GitHub.Api(
                    "repos/" + run.Text("repo") + "/pulls",
                    PullRequest(
                        run,
                        (RequestMetadata.Incomplete(J.Get(request, "metadata")) ? "Incomplete: ": "") + J.Text(
                            J.Get(record, "issue"),
                            "title"
                        ),
                        body,
                        true,
                        Policy(J.Write(J.Get(record, "policy"))).MaintainerEdits
                    )
                )
                Match(run, pull, expected)
            }
            if newIntent && J.Text(pull, "body") != body {
                pull = GitHub.Api(
                    "repos/" + run.Text("repo") + "/pulls/" + J.Number(pull, "number").ToString(),
                    map[string, Object?]{"body": body},
                    "PATCH"
                )
                Match(run, pull, expected)
            }
            let metadata = Dictionary[string, Object?]()
            for field in J.Get(request, "metadata").EnumerateObject() {
                metadata[field.Name] = field.Value
            }
            metadata["pr"] = J.Number(pull, "number")
            let fields = J.Select(request, "uuid,expected,approval,action")
            fields["metadata"] = metadata
            return J.Parse(J.Write(fields))
        }

        internal func SavePr(directory string, run Data, pull JsonElement) {
            run.Fields["pr"] = J.Number(pull, "number")
            run.Fields["pr_url"] = J.Text(pull, "html_url")
            run.Transition("published")

            run.Save(directory)

            Output.Sink.Message((run.Flag("gratis") && run.Flag("ready") ? "PR: ": "Draft PR: ") + run.Text("pr_url"))
        }

        internal func PublishGratis(
            directory string,
            run Data,
            confirm Func[Dictionary[string, Object?], string, bool]
        ) {
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
                ". No owner approved the task. Tokate ran no repository checks. Repository CI still applies." +
                PublicSummary.Tools(J.Parse(J.Write([]Object{tool})), "Donor-reported tools")
            let receiptText = J.Write(receipt)
            let marker = "<!-- tokate-receipt:" + receiptText + " -->"
            let report = PrBody.Report(PrBody.PublicReport(J.Parse(receiptText)))
            let body = (run.Number("issue") > 0 ? "Fixes #" + run.Number("issue").ToString() + "\n\n": "") +
                report +
                "\n\n" +
                attribution +
                "\n\n<!-- tokate-v2:" +
                id +
                " -->\n" +
                marker

            let pullRequest = Publication.PullRequest(
                run,
                run.Text("gratis_title") == "" ? J.Text(J.Get(context, "issue"), "title"): run.Text("gratis_title"),
                body,
                !run.Flag("ready"),
                true
            )
            let findings = run.Text("findings")
            let discussionTitle = "Tokate donation findings"
            let discussionBody = findings == "" ? "": findings + "\n\n" + attribution + "\n\n" + marker
            let preview = map[string, Object?]{"repo": repoName, "applied": false}
            var consent = "Repository: " + repoName

            if run.Text("state") == "generated" {
                preview["pull_request"] = pullRequest
                consent += "\nBase: " + run.Text("base_branch") + "\nFork branch: " + donor + ":" + run.Text("branch") +
                    "\nTitle: " +
                    pullRequest["title"]?.ToString() + "\nBody:\n" + body
            }

            if findings != "" {
                preview["discussion"] = map[string, Object?]{"title": discussionTitle, "body": discussionBody}
                consent += "\nDiscussion title: " + discussionTitle + "\nDiscussion body:\n" + discussionBody
            }

            if !confirm(preview, consent) {
                return
            }

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
                let pull = GitHub.Api("repos/" + repoName + "/pulls", pullRequest)
                Publication.SavePr(directory, run, pull)
                preview["applied"] = true
            }

            if findings == "" {
                return
            }

            PublishDiscussion(directory, run, repoName, discussionTitle, discussionBody, preview)
        }

        private func PublishDiscussion(
            directory string,
            run Data,
            repoName string,
            discussionTitle string,
            discussionBody string,
            preview Dictionary[string, Object?]
        ) {
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
                    "title": discussionTitle,
                    "body": discussionBody
                }

                let posted = Query(
                    repoName,
                    "mutation($$repo:ID!,$$category:ID!,$$title:String!,$$body:String!){createDiscussion(input:{repositoryId:$$repo,categoryId:$$category,title:$$title,body:$$body}){discussion{url}}}",
                    input
                )

                let url = J.Text(J.Get(J.Get(posted, "createDiscussion"), "discussion"), "url")
                Require(url != "", "Discussion publication failed")

                preview["applied"] = true
                run.Fields["discussion_url"] = url
                run.Transition("published")
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
