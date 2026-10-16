package Tokate

import System
import System.Collections.Generic
import System.Text.Json

internal class Publication {
    shared {
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

        internal func Match(run Data, pull JsonElement, expectedReceipt JsonElement) {
            let marker = "<!-- tokate-v2:" + run.Text("id") + " -->"
            let body = J.Text(pull, "body")
            let failure = "interrupted_publication: physical PR differs from exact saved run/head/receipt"
            let receipt = RequestData.Parse(PrBody.ReceiptText(body, failure, failure))

            if !RepositoryIdentity.SameRepo(J.Text(receipt, "repo"), J.Text(expectedReceipt, "repo")) {
                throw CliFailure("invalid_state", failure)
            }

            let comparable = Dictionary[string, Object?]()

            for field in receipt.EnumerateObject() {
                comparable[field.Name] = field.Name == "repo" ? J.Text(expectedReceipt, "repo"): field.Value
            }

            if !RequestData.Same(J.Parse(J.Write(comparable)), expectedReceipt) || !body.Contains(marker) ||
                body.IndexOf(marker, StringComparison.Ordinal) != body.LastIndexOf(marker, StringComparison.Ordinal) {
                throw CliFailure("invalid_state", failure)
            }

            let head = J.Get(pull, "head")
            let base = J.Get(pull, "base")

            if J.Text(head, "sha") != J.Text(expectedReceipt, "head") || J.Text(head, "ref") != run.Text("branch") ||
                !RepositoryIdentity
                .SameRepo(J.Text(J.Get(head, "repo"), "full_name"), run.Text("head_repo")) {
                throw CliFailure("invalid_state", failure)
            }

            let baseRepo = J.Text(J.Get(base, "repo"), "full_name")
            let mergedAt = J.Get(pull, "merged_at").ValueKind

            if J.Text(base, "ref") != run.Text("base_branch") || !RepositoryIdentity.SameRepo(
                baseRepo,
                run.Text("repo")
            ) ||
                J.Text(pull, "state") != "open" || !J.Bool(pull, "draft") || J.Bool(pull, "merged") ||
                (mergedAt != JsonValueKind.Undefined && mergedAt != JsonValueKind.Null) ||
                J.Number(pull, "number") < 1 {
                throw CliFailure("invalid_state", failure)
            }
        }

        internal func Find(run Data, expectedReceipt JsonElement) JsonElement {
            let pulls = Pulls(run)

            if pulls.Count > 1 {
                throw CliFailure("invalid_state", "interrupted_publication: ambiguous physical PRs; intent preserved")
            }

            if pulls.Count == 0 {
                return JsonElement{}
            }

            Match(run, pulls[0], expectedReceipt)

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

        internal func Prepare(run Data, record JsonElement, request JsonElement) JsonElement {
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
            var pull = Find(run, expected)
            if pull.ValueKind == JsonValueKind.Undefined {
                pull = GitHub.Api(
                    "repos/" + run.Text("repo") + "/pulls",
                    PullRequest(
                        run,
                        (RequestData.Incomplete(J.Get(request, "metadata")) ? "Incomplete: ": "") + J.Text(
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
            if J.Get(J.Get(pull, "user"), "id").ToString() != J.Get(run.Element(), "donor_id").ToString() {
                throw CliFailure("invalid_state", "Publication PR author differs from reserved donor")
            }
            if J.Text(pull, "body") != body {
                throw CliFailure("invalid_state", "Existing PR body differs from canonical publication")
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

            Terminal.Message((run.Flag("gratis") && run.Flag("ready") ? "PR: ": "Draft PR: ") + run.Text("pr_url"))
        }
    }
}
