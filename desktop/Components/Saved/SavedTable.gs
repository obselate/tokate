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
    var Narrow bool
    var Disabled bool
    var OnOpen Action[SavedRun]?

    func Build() Blob {
        let rows = List[Blob]()
        for index in 0 ... Rows.Length {
            let item = Rows[index]
            if item.Status() != "Merged" {
                rows.Add(
                    SavedRow{
                        Item: item,
                        Index: FirstIndex + index,
                        Disabled: Disabled,
                        Narrow: Narrow,
                        OnOpen: OnOpen,
                    }.Build()
                )
            }
        }
        let count = rows.Count
        if count == 0 {
            rows.Add(
                Reading ? ListRow{Children: []Blob{Loader{Message: "Reading saved contributions", Key: "saved-loading"}.Build()}}.Build(): EmptyMessage{
                    Content: Total == 0 ? "No saved contributions": "No unmerged contributions on this page",
                    Icon: "inbox",
                }.Build()
            )
        }
        return ListSection{Title: "Contributions", Count: count, Children: rows.ToArray()}.Build()
    }
}
