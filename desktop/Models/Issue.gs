package TokateDesktop

import System

data struct Issue {
    var Number int32
    var Title string
    var State string
    var IsPullRequest bool
    var Labels []string
    var Url string

    prop NumberText string -> Number.ToString()

    prop IsApproved bool -> Array.IndexOf(Labels, "tokate:approved") >= 0

    prop IsOpen bool -> State == "open"
}

enum IssueFilter {
    All,
    Approved,
    NeedsApproval
}

data struct IssueListing {
    var Query string
    var AppliedQuery string
    var Filter IssueFilter
    var Page int32
    var Total int32
    var Loaded bool
    var Incomplete bool
    var Rows []Issue

    prop Truncated bool -> Total > 1000 || Incomplete

    prop VisibleTotal int32 -> Math.Min(1000, Total)

    func RequestedNumber() int32 -> int32.TryParse(AppliedQuery.TrimStart('#'), out var number) && number > 0 ? number: 0

    func Accepts(issue Issue, repository string) bool {
        if !issue.IsOpen || issue.IsPullRequest {
            return false
        }
        if !issue.Url.StartsWith("https://github.com/" + repository + "/issues/", StringComparison.OrdinalIgnoreCase) {
            return false
        }
        return !(Filter == IssueFilter.Approved && !issue.IsApproved) &&
            !(Filter == IssueFilter.NeedsApproval && issue.IsApproved)
    }

    shared {
        let PageSize int32 = 8

        func Empty(filter IssueFilter) IssueListing -> IssueListing{
            Query: "",
            AppliedQuery: "",
            Filter: filter,
            Page: 1,
            Rows: []Issue{},
        }

        func LastPage(total int32) int32 -> Math.Max(1, (total + PageSize - 1) / PageSize)

        func FilterLabel(filter IssueFilter) string -> switch filter {
            case IssueFilter.Approved: "Approved"
            case IssueFilter.NeedsApproval: "Needs approval"
            default: "All open"
        }
    }
}
