package TokateDesktop

import Goo
import System

/// The current page of issues, the loading state of the first search, or a placeholder once a search finds
/// nothing.
data struct IssueTable {
    var Listing IssueListing
    var Short bool
    var Busy bool
    var ShowApproval bool
    var Loader Func[string, Blob]?
    var OnChoose Action[Issue]?

    func Build() Blob {
        let choose = OnChoose
        let table = ListPanel{Short: Short}.Build()
        for issue in Listing.Rows {
            let selected = issue
            table.Children.Add(IssueRow{Issue: issue, Disabled: Busy, ShowApproval: ShowApproval, OnChoose: () -> choose?.Invoke(selected)}.Build())
        }
        if Listing.Loaded && Listing.Rows.Length == 0 {
            table.Children.Add(
                Busy && Loader != nil ? Loader!!("Searching issues"): EmptyMessage{Content: "No matching issues", Icon: "search_off"}.Build()
            )
        }
        return table
    }
}
