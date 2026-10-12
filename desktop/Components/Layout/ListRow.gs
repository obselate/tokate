package TokateDesktop

import Goo

/// One line of a list: wrapping items centered on a row at least 64 high.
data struct ListRow {
    var Children []Blob

    func Build() Container {
        let row = Row{Children: Children}.Build()
        row.MinHeight = 64
        row.AlignContent = AlignContent.Center
        row.Padding = Edges{Left: 20, Right: 16, Top: 10, Bottom: 10}
        return row
    }
}
