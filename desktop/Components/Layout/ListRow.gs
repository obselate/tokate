package TokateDesktop

import Goo
import System

/// One line of a list: wrapping items centered on a row at least 64 high.
data struct ListRow {
    var Children []Blob
    var Name string
    var Disabled bool
    var OnChoose Action?

    func Build() Blob {
        let choose = OnChoose
        let row Blob = choose == nil ? Row{Children: Children}.Build(): Button{
            FlexDirection: FlexDirection.Row,
            FlexWrap: FlexWrap.Wrap,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.FlexStart,
            Gap: AppTheme.Space12,
            Focusable: true,
            Disabled: Disabled,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: Name},
            OnClick: () -> choose?.Invoke(),
            Children: Children,
        }
        row.MinHeight = AppTheme.RowHeight
        row.AlignContent = AlignContent.Center
        row.Padding = Edges{Left: AppTheme.CardPadding, Right: AppTheme.CardPadding, Top: AppTheme.Space12, Bottom: AppTheme.Space12}
        row.Hover = Style{BackgroundColor: AppTheme.Current.Paper}
        row.Focus = AppTheme.FocusStyle()
        if choose != nil {
            Interaction.Keyboard(row)
        }
        return row
    }
}
