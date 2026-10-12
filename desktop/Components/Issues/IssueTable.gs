package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The current page of issues, the loading state of a search without rows, or a placeholder once a search
/// finds nothing.
data struct IssueTable {
    var Listing IssueListing
    var Short bool
    var Busy bool
    var ShowApproval bool
    var Loader Func[string, Blob]?
    var OnChoose Action[Issue]?

    func Build() Blob {
        let choose = OnChoose
        let rows = List[Blob]()
        for issue in Listing.Rows {
            let selected = issue
            rows.Add(
                IssueRow{
                    Issue: issue,
                    Disabled: Busy,
                    ShowApproval: ShowApproval,
                    Last: rows.Count == Listing.Rows.Length - 1,
                    OnChoose: () -> choose?.Invoke(selected),
                }.Build()
            )
        }
        if rows.Count == 0 && Busy && Loader != nil {
            rows.Add(Loader!!(Listing.Loaded ? "Searching issues": "Reading issues"))
        } else if rows.Count == 0 && Listing.Loaded {
            rows.Add(EmptyMessage{Content: "No matching issues", Icon: "search_off"}.Build())
        }
        return ListPanel{Short: Short, Fill: Listing.Rows.Length == 0, Children: rows.ToArray()}.Build()
    }
}
