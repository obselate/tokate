package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class GratisPublication {
    shared {
        internal func Submit(directory string) string {
            using let lease = RunStorage.Lease(directory)
            return SubmitPrepared(directory, Data.Load(directory))
        }

        internal func SubmitPrepared(directory string, run Data) string {
            let record = ContributionAuthority.Recheck(run)
            if run.Text("state") == "skipped" {
                return "skipped"
            }
            if run.Text("state") == "generated" {
                Verification.Results(run, record)
                Submission.CommitPrepared(directory, run)
                let tools = J.Parse(J.Write(Submission.PublicationTools(run)))
                let fields = ContributionReceipt.Coordinated(
                    run.Text("repo"),
                    run.Number("issue"),
                    "",
                    "",
                    run.Text("id"),
                    run.Text("donor"),
                    run.Text("commit")
                )
                fields["mode"] = "gratis"
                fields["owner_approved"] = false
                fields["prompt_sha256"] = run.Text("prompt_hash")
                fields["tools"] = tools
                fields["verification"] = J.Count(
                    J.Get(run.Element(), "verification")
                ) == 0 ? "not-run": "donor-reported-pass"
                let receipt = J.Parse(J.Write(fields))
                let report = Attribution(run) + "\n\n" + PublicSummary.Report(
                    PublicSummary.ForHead(run, run.Text("commit")),
                    J.Count(
                        J.Get(run.Element(), "verification")
                    ) == 0 ? "No repository check ran. Repository CI still applies.": "Repository guidance checks passed locally. Repository CI still applies."
                ) +
                    PublicSummary.Tools(tools, "Donor-reported tools")
                let body = "<!-- tokate-v2:" + run.Text("id") + " -->\n" + PrBody.Report(report) +
                    "\n<!-- tokate-receipt:" +
                    J.Write(receipt) + " -->"
                let intent = map[string, Object?]{
                    "title": J.Text(J.Get(record, "issue"), "title"),
                    "body": body,
                    "head": run.Text("donor") + ":" + run.Text("branch"),
                    "base": run.Text("base_branch"),
                    "draft": !J.Bool(J.Get(record, "guidance"), "ready_prs"),
                    "maintainer_can_modify": false
                }
                if File.Exists(Path.Combine(directory, "publication.json")) {
                    throw CliFailure("invalid_state", "Gratis publication already attempted; inspect the saved intent")
                }
                File.WriteAllText(Path.Combine(directory, "publication.json"), J.Write(intent))
                ContributionAuthority.Recheck(run)
                Publication.Push(Path.Combine(directory, "checkout"), run, run.Text("commit"))
                ContributionAuthority.Recheck(run)
                let pull = GitHub.Api("repos/" + run.Text("repo") + "/pulls", intent)
                if J.Number(pull, "number") < 1 || J.Text(J.Get(pull, "head"), "sha") != run.Text("commit") {
                    throw CliFailure("invalid_state", "Gratis PR result does not match the saved candidate")
                }
                Publication.SavePr(directory, run, pull)
            } else if run.Text("state") != "findings" {
                throw CliFailure("invalid_state", "Gratis task did not produce a completed outcome")
            }
            let findings = Path.Combine(directory, "findings.md")
            if J.Bool(J.Get(record, "guidance"), "discussions") && File.Exists(findings) && !String.IsNullOrWhiteSpace(
                File.ReadAllText(findings)
            ) {
                Discussion(directory, run, File.ReadAllText(findings))
            }
            if run.Text("state") == "findings" {
                run.Fields["state"] = "published"
                run.Save(directory)
            }
            return "submitted"
        }

        private func Attribution(run Data) string -> "Donated with [Tokate](https://github.com/obselate/tokate) by @" +
            run.Text("donor") + ". No owner approved the task."

        private func Discussion(directory string, run Data, findings string) {
            ContributionAuthority.Recheck(run)
            let repo = run.Text("repo").Split('/')
            let data = Gratis.Graph(
                "query($$owner:String!,$$name:String!){repository(owner:$$owner,name:$$name){id discussionCategories(first:100){nodes{id name isAnswerable} pageInfo{hasNextPage}}}}",
                map[string, Object?]{"owner": repo[0], "name": repo[1]}
            )
            let repository = J.Get(data, "repository")
            let categories = J.Get(repository, "discussionCategories")
            if J.Bool(J.Get(categories, "pageInfo"), "hasNextPage") || J.Text(repository, "id") == "" {
                throw CliFailure("invalid_state", "Discussion categories are incomplete")
            }
            var category = ""
            for entry in J.Items(J.Get(categories, "nodes")) {
                if !J.Bool(entry, "isAnswerable") && category == "" {
                    category = J.Text(entry, "id")
                }
                if String.Equals(J.Text(entry, "name"), "General", StringComparison.OrdinalIgnoreCase) {
                    category = J.Text(entry, "id")
                    break
                }
            }
            if category == "" {
                throw CliFailure("invalid_state", "No Discussion category accepts findings")
            }
            let tools = J.Parse(J.Write(Submission.PublicationTools(run)))
            let fields = ContributionReceipt.Coordinated(
                run.Text("repo"),
                run.Number("issue"),
                "",
                "",
                run.Text("id"),
                run.Text("donor"),
                run.Text("commit")
            )
            fields["mode"] = "gratis"
            fields["owner_approved"] = false
            fields["prompt_sha256"] = run.Text("prompt_hash")
            fields["tools"] = tools
            fields["verification"] = J.Count(
                J.Get(run.Element(), "verification")
            ) == 0 ? "not-run": "donor-reported-pass"
            let body = PrBody.Report(
                Attribution(run) +
                    "\n\n" +
                    (
                    J.Count(
                        J.Get(run.Element(), "verification")
                    ) == 0 ? "No repository check ran. Repository CI still applies.\n\n": "Repository guidance checks passed locally. Repository CI still applies.\n\n"
                ) +
                    findings +
                    "\n\n" +
                    PublicSummary.Tools(tools, "Donor-reported tools")
            ) +
                "\n<!-- tokate-receipt:" +
                J.Write(fields) + " -->"
            let variables = map[string, Object?]{
                "repository": J.Text(repository, "id"),
                "category": category,
                "title": "Tokate donated findings",
                "body": body
            }
            let path = Path.Combine(directory, "discussion.json")
            if File.Exists(path) {
                throw CliFailure("invalid_state", "Findings publication already attempted; inspect the saved intent")
            }
            File.WriteAllText(path, J.Write(variables))
            let result = Gratis.Graph(
                "mutation($$repository:ID!,$$category:ID!,$$title:String!,$$body:String!){createDiscussion(input:{repositoryId:$$repository,categoryId:$$category,title:$$title,body:$$body}){discussion{url}}}",
                variables
            )
            let url = J.Text(J.Get(J.Get(result, "createDiscussion"), "discussion"), "url")
            if url == "" {
                throw CliFailure("invalid_state", "Findings publication result is missing")
            }
            run.Fields["discussion_url"] = url
            run.Save(directory)
        }
    }
}
