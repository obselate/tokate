package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The visible page of saved runs. Merged runs are hidden.
data struct SavedTable {
    var Rows []SavedRun
    var FirstIndex int32
    var Total int32
    var Reading bool
    var Short bool
    var Disabled bool
    var OnOpen Action[SavedRun]?

    func Build() Blob {
        let rows = List[Blob]()
        for index in 0 ... Rows.Length {
            let item = Rows[index]
            if item.Status() != "Merged" {
                rows.Add(SavedRow{Item: item, Index: FirstIndex + index, Disabled: Disabled, OnOpen: OnOpen}.Build())
            }
        }
        if rows.Count == 0 {
            rows.Add(
                EmptyMessage{
                    Content: Reading ? "Reading saved contributions": Total == 0 ? "No saved contributions": "No unmerged contributions on this page",
                    Icon: Reading ? "schedule": "inbox",
                }.Build()
            )
        }
        return ListPanel{Short: Short, Children: rows.ToArray()}.Build()
    }
}
