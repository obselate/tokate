package TokateDesktop

import System
import System.Collections.Generic
import System.Text.Json

data struct IssueSearchPage {
    var Rows []Issue
    var Total int32
    var Incomplete bool
}

class IssueCodec {
    shared {
        func Issue(value JsonElement) Issue {
            let labels = List[string]()
            for label in Json.Items(value, "labels") {
                labels.Add(Json.Text(label, "name"))
            }
            return Issue{
                Number: Json.Int(value, "number"),
                Title: Json.Text(value, "title"),
                State: Json.Text(value, "state"),
                IsPullRequest: Json.Get(value, "pull_request").ValueKind != JsonValueKind.Undefined,
                Labels: labels.ToArray(),
                Url: Json.Text(value, "html_url"),
            }
        }

        func Search(value JsonElement) IssueSearchPage {
            let rows = List[Issue]()
            for item in Json.Items(value, "items") {
                rows.Add(Issue(item))
            }
            return IssueSearchPage{
                Rows: rows.ToArray(),
                Total: Json.Int(value, "total_count"),
                Incomplete: Json.Bool(value, "incomplete_results"),
            }
        }

        /// A single issue fetched by number, as a one-row page.
        func Single(value JsonElement) IssueSearchPage -> IssueSearchPage{Rows: []Issue{Issue(value)}, Total: 1}

        func Work(data JsonElement) []IssueWork {
            let result = List[IssueWork]()
            for item in Json.Items(data, "work") {
                let drafts = List[string]()
                let reviews = List[DraftReview]()
                for draft in Json.Items(item, "drafts") {
                    drafts.Add(Json.Text(draft, "pr"))
                    let lifecycle = Json.Text(draft, "lifecycle")
                    let state = lifecycle == "merged" ? "Merged": Json.Text(draft, "state") == "closed" ? "Closed": ""
                    if state != "" {
                        reviews.Add(DraftReview{Pr: Json.Text(draft, "pr"), State: state, Receipt: "", Ci: ""})
                    }
                }
                result.Add(
                    IssueWork{
                        Issue: Json.Text(item, "issue"),
                        State: Json.Text(item, "state"),
                        Drafts: drafts.ToArray(),
                        Reviews: reviews.ToArray(),
                        ApprovalStatus: Json.Text(item, "approval_status"),
                        NextAction: Json.Text(Json.Get(item, "next"), "action"),
                    }
                )
            }
            return result.ToArray()
        }
    }
}
