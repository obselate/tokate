package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class Publication {
    shared {
        internal const HistoryPageCountLimit int32 = 20

        private const DiscussionCategoriesQuery string = "query($$owner:String!,$$name:String!){repository(owner:$$owner,name:$$name){id discussionCategories(first:100){nodes{id name} pageInfo{hasNextPage}}}}"

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
                GitHub.WebUrl + run.HeadRepo + ".git",
                commit + ":" + GitHub.HeadsRefPrefix + run.Branch
            )
        }

        internal func Pulls(run Data) List[JsonElement] {
            let pulls = List[JsonElement]()

            for page in 1 ... HistoryPageCountLimit + 1 {
                let response = GitHub.Api(
                    "repos/" + RepositoryIdentity.Repo(run.Repo) + "/pulls?state=all&head=" + Uri.EscapeDataString(
                        run.Donor + ":" + run.Branch
                    ) +
                        "&" +
                        GitHub.PageSizeParameter +
                        "&page=" +
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

                if rows.Count < GitHub.PageSize {
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
            if J.Text(head, "ref") != run.Branch || !RepositoryIdentity.SameRepo(
                J.Text(J.Get(head, "repo"), "full_name"),
                run.HeadRepo
            ) ||
                J.Text(base, "ref") != run.BaseBranch || !RepositoryIdentity.SameRepo(
                J.Text(J.Get(base, "repo"), "full_name"),
                run.Repo
            ) ||
                J.Text(pull, "state") != "open" || !J.Bool(pull, "draft") || J.Bool(pull, "merged") ||
                (mergedAt != JsonValueKind.Undefined && mergedAt != JsonValueKind.Null) ||
                J.Number(pull, "number") < 1 || J.Get(J.Get(pull, "user"), "id").ToString() != run.DonorId.ToString() {
                throw CliFailure("invalid_state", failure)
            }
            if newIntent {
                return
            }
            let marker = RequestData.OwnershipMarkerPrefix + run.Id + " -->"
            let body = J.Text(pull, "body")
            let receipt = ContributionReceipt.Record.Parse(
                RequestData.Parse(PrBody.ReceiptText(body, failure, failure), RequestData.RequestByteLimit)
            )
            let expected = ContributionReceipt.Record.Parse(expectedReceipt)
            if !RepositoryIdentity.SameRepo(receipt.Repo, expected.Repo) {
                throw CliFailure("invalid_state", failure)
            }
            let comparable = map[string, Object?]{}
            for field in receipt.ToJson().EnumerateObject() {
                comparable[field.Name] = field.Name == "repo" ? expected.Repo: field.Value
            }
            if !RequestData.Same(J.Parse(J.Write(comparable)), expected.ToJson()) || !body.Contains(marker) ||
                body.IndexOf(marker, StringComparison.Ordinal) != body.LastIndexOf(marker, StringComparison.Ordinal) ||
                J.Text(head, "sha") != expected.Head {
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
                "head": run.HeadRepo.Split('/')[0] + ":" + run.Branch,
                "base": run.BaseBranch,
                "draft": draft
            }
            if !RepositoryIdentity.SameRepo(run.HeadRepo, run.Repo) {
                fields["maintainer_can_modify"] = maintainerEdits
            }
            return fields
        }

        internal func Prepare(run Data, record JsonElement, request JsonElement, newIntent bool = false) JsonElement {
            let declaration = CoordinatorRequest.Parse(request)
            let publication = PublicationRequestMetadata.Parse(declaration.Metadata)
            let receipt = ContributionReceipt.Publication(run.Repo, run.Issue, request, run.Id, run.Donor)
            let body = PrBody.Coordinated(
                record,
                declaration.Metadata,
                run.Donor,
                receipt,
                RequestData.OwnershipMarkerPrefix + run.Id + " -->"
            )
            RepositoryAccess.ValidateFork(run.Repo, publication.Fork, publication.Branch, publication.Head, run.DonorId)
            let expected = receipt.ToJson()
            var pull = Find(run, expected, newIntent)
            if pull.ValueKind == JsonValueKind.Undefined {
                pull = GitHub.Api(
                    "repos/" + run.Repo + "/pulls",
                    PullRequest(
                        run,
                        (publication.Incomplete ? "Incomplete: ": "") + J.Text(J.Get(record, "issue"), "title"),
                        body,
                        true,
                        Policy(J.Write(J.Get(record, "policy"))).MaintainerEdits
                    )
                )
                Match(run, pull, expected)
            }
            if newIntent && J.Text(pull, "body") != body {
                pull = GitHub.Api(
                    "repos/" + run.Repo + "/pulls/" + J.Number(pull, "number").ToString(),
                    map[string, Object?]{"body": body},
                    "PATCH"
                )
                Match(run, pull, expected)
            }
            let updated = CoordinatorRequest(
                declaration.Uuid,
                declaration.Expected,
                declaration.Approval,
                declaration.Action,
                publication.WithPr(J.Number(pull, "number"))
            )

            return J.Parse(updated.ToJson())
        }

        internal func SavePr(directory string, run Data, pull JsonElement) {
            run.Pr = J.Number(pull, "number")
            run.PrUrl = J.Text(pull, "html_url")
            run.Transition("published")

            run.Save(directory)

            Output.Sink.Message((run.Gratis && run.Ready ? "PR: ": "Draft PR: ") + run.PrUrl)
        }

        internal func PublishGratis(
            directory string,
            run Data,
            confirm Func[Dictionary[string, Object?], string, bool]
        ) {
            ContributionAuthority.Recheck(run)

            if run.State == "refused" {
                return
            }

            Require(run.State == "generated" || run.State == "skipped", "Task is not ready")

            let repoName = run.Repo
            let donor = run.Donor
            let id = run.Id
            let head = run.Commit
            let context = run.GratisContext
            let tool = J.Select(run.Element(), "harness,provider,model,effort")
            tool["coding_seconds"] = run.ExecutionSeconds
            tool["usage"] = run.Usage

            let receipt = ContributionReceipt.Coordinated(repoName, run.Issue, "", "", id, donor, head)
            receipt["mode"] = "gratis"
            receipt["owner_approved"] = false
            receipt["tools"] = []Object{tool}
            receipt["verification"] = []Object{}
            receipt["prompt_sha256"] = J.Text(context, "prompt_sha256")
            let summary = head == "" ? run.PublicSummary: PublicSummary.ForHead(run, head)
            PublicSummary.Attach(receipt, summary)

            let attribution = "Donated with [Tokate](" +
                GitHub.WebUrl +
                "obselate/tokate) by @" +
                donor +
                ". No owner approved the task. Tokate ran no repository checks. Repository CI still applies." +
                PublicSummary.Tools(J.Parse(J.Write([]Object{tool})), "Donor-reported tools")
            let receiptText = J.Write(receipt)
            let marker = PrBody.ReceiptPrefix + receiptText + " -->"
            let report = PrBody.Report(PrBody.PublicReport(J.Parse(receiptText)))
            let body = (run.Issue > 0 ? "Fixes #" + run.Issue.ToString() + "\n\n": "") +
                report +
                "\n\n" +
                attribution +
                "\n\n" +
                RequestData.OwnershipMarkerPrefix +
                id +
                " -->\n" +
                marker

            let pullRequest = Publication.PullRequest(
                run,
                run.GratisTitle == "" ? J.Text(J.Get(context, "issue"), "title"): run.GratisTitle,
                body,
                !run.Ready,
                true
            )
            let findings = run.Findings
            let discussionTitle = "Tokate donation findings"
            let discussionBody = findings == "" ? "": findings + "\n\n" + attribution + "\n\n" + marker
            let preview = map[string, Object?]{"repo": repoName, "applied": false}
            var consent = "Repository: " + repoName

            if run.State == "generated" {
                preview["pull_request"] = pullRequest
                consent += "\nBase: " +
                    run.BaseBranch +
                    "\nFork branch: " +
                    donor +
                    ":" +
                    run.Branch +
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

            if run.State == "generated" {
                let checkout = Verification.Candidate(Path.Combine(directory, "checkout"))
                Require(Commands.Git(checkout, "rev-parse", "HEAD") == run.Commit, "Verified head changed")
                Require(Commands.Git(checkout, "status", "--porcelain") == "", "Verified checkout changed")

                File.WriteAllText(Path.Combine(directory, "publication.json"), J.Write(receipt))
                Require(!run.PublicationAttempted, "PR publication was already attempted")
                Publication.Push(checkout, run, run.Commit)
                ContributionAuthority.Recheck(run)
                run.PublicationAttempted = true
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
                Require(!run.DiscussionAttempted, "Discussion publication was already attempted")

                let result = Query(repoName, DiscussionCategoriesQuery)
                let repo = J.Get(result, "repository")
                var category string = ""

                for entry in J.Items(J.Get(J.Get(repo, "discussionCategories"), "nodes")) {
                    if J.Text(entry, "name") == "General" {
                        category = J.Text(entry, "id")
                    }
                }

                Require(category != "", "General Discussion category is unavailable")

                run.DiscussionAttempted = true
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
                run.DiscussionUrl = url
                run.Transition("published")
            } catch (error Exception) when !(error is CommandInterrupted) {
                run.DiscussionError = error.Message

                if run.Pr == 0 {
                    throw error
                }
            } finally {
                run.Save(directory)
            }
        }
    }
}
