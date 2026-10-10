package TokateDesktop

import Goo
import System

/// The current page of issues, or a placeholder once a search finds nothing.
data struct IssueTable {
    var Listing IssueListing
    var Short bool
    var Busy bool
    var OnChoose Action[Issue]?

    func Build() Blob {
        let choose = OnChoose
        let table = ListPanel{Short: Short}.Build()
        for issue in Listing.Rows {
            let selected = issue
            table.Children.Add(IssueRow{Issue: issue, Disabled: Busy, OnChoose: () -> choose?.Invoke(selected)}.Build())
        }
        if Listing.Loaded && Listing.Rows.Length == 0 && !Busy {
            table.Children.Add(EmptyMessage{Content: "No matching issues"}.Build())
        }
        return table
    }
}
