package TokateDesktop

import Goo

/// One line of a list: wrapping items centered on a row at least 64 high.
data struct ListRow {
    var Children []Blob

    func Build() Container {
        let row = Row{Children: Children}.Build()
        row.MinHeight = AppTheme.RowHeight
        row.AlignContent = AlignContent.Center
        row.Padding = Edges{Left: AppTheme.CardPadding, Right: AppTheme.CardPadding, Top: AppTheme.Space12, Bottom: AppTheme.Space12}
        return row
    }
}
