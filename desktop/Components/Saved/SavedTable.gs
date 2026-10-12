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
    var Narrow bool
    var Disabled bool
    var Loader Func[string, Blob]?
    var OnOpen Action[SavedRun]?

    func Build() Blob {
        let rows = List[Blob]()
        var last = -1
        for index in 0 ... Rows.Length {
            if Rows[index].Status() != "Merged" {
                last = index
            }
        }
        for index in 0 ... Rows.Length {
            let item = Rows[index]
            if item.Status() != "Merged" {
                rows.Add(
                    SavedRow{
                        Item: item,
                        Index: FirstIndex + index,
                        Disabled: Disabled,
                        Last: index == last,
                        Narrow: Narrow,
                        OnOpen: OnOpen,
                    }.Build()
                )
            }
        }
        if last < 0 {
            rows.Add(
                Reading && Loader != nil ? Loader!!("Reading saved contributions"): EmptyMessage{
                    Content: Total == 0 ? "No saved contributions": "No unmerged contributions on this page",
                    Icon: "inbox",
                }.Build()
            )
        }
        return ListPanel{Short: Short, Fill: last < 0, Children: rows.ToArray()}.Build()
    }
}
