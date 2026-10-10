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

        func Work(data JsonElement) []IssueWork {
            let result = List[IssueWork]()
            for item in Json.Items(data, "work") {
                let drafts = List[string]()
                for draft in Json.Items(item, "drafts") {
                    drafts.Add(Json.Text(draft, "pr"))
                }
                result.Add(
                    IssueWork{Issue: Json.Text(item, "issue"), State: Json.Text(item, "state"), Drafts: drafts.ToArray()}
                )
            }
            return result.ToArray()
        }
    }
}
