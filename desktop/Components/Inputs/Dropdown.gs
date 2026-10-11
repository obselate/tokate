package TokateDesktop

import Goo
import Goo.Widgets.Inputs
import System

/// A labeled single-choice list. Popup key and pointer events are forwarded so the host can track focus hints.
data struct Dropdown {
    var Caption string
    var Value string
    var Options []ComboBoxOption
    var OnChange Action[string]?
    var Width float64
    var Disabled bool
    var OnPopupKey Action[KeyEvent]?
    var OnPopupPointer Action[PointerEvent]?

    func Build() Blob {
        let change = OnChange
        let key = OnPopupKey
        let pointer = OnPopupPointer
        return Interaction.RevealFocus(
            Container{
                Width: Width,
                MaxWidth: Percent(100),
                Gap: 6,
                Label{Content: Caption, Size: AppTheme.SmallSize, Muted: true}.Build(),
                Cell.Mount[ComboBoxInput, ComboBox](
                    nil,
                    ComboBoxInput{
                        Items: Options,
                        SelectedId: Value,
                        Placeholder: Value,
                        OnSelect: selected -> change?.Invoke(selected),
                        AccessibilityName: Caption,
                        Disabled: Disabled,
                        Width: Width,
                        RowHeight: 40,
                        CreateRoot: (input, root) -> {
                            root.MaxWidth = Percent(100)
                            return root
                        },
                        CreateTrigger: (input, button) -> {
                            let p = AppTheme.Current
                            button.Height = 44
                            button.BackgroundColor = p.Surface
                            button.BorderColor = p.Line
                            button.BorderRadius = AppTheme.ControlRadius
                            button.Focus = AppTheme.FocusStyle()
                            button.Hover = Style{BorderColor: p.Accent}
                            return button
                        },
                        CreateRow: (input, item, row) -> {
                            let p = AppTheme.Current
                            row.BackgroundColor = item.Id == input.SelectedId ? p.Paper: p.Surface
                            row.Hover = Style{BackgroundColor: p.Paper}
                            row.OutlineColor = AppTheme.FocusVisible ? p.Accent: Color.Transparent
                            return row
                        },
                        CreatePopup: (input, popup) -> {
                            popup.BackgroundColor = AppTheme.Current.Surface
                            popup.BorderColor = AppTheme.Current.Line
                            popup.OnKeyDown = event -> key?.Invoke(event)
                            popup.OnPointerDown = event -> pointer?.Invoke(event)
                            return popup
                        },
                    }
                ),
            }
        )
    }
}
