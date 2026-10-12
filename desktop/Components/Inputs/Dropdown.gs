package TokateDesktop

import Goo
import Goo.Widgets.Icons
import Goo.Widgets.Inputs
import System

/// What a popup needs from the window. A popup shows outside the page, so the editing keys and the focus
/// hints of the page do not reach it.
data struct PopupInput {
    var KeyBindings []KeyBinding?
    var OnKeyDown Action[KeyEvent]?
    var OnPointerDown Action[PointerEvent]?
}

/// A labeled single-choice list, disabled while it has no options. Popup key and pointer events are forwarded so the host can track focus hints.
data struct Dropdown {
    var Caption string
    var Value string
    /// The text that shows when no option is selected.
    var Placeholder string
    /// Whether the list has a search field.
    var Searchable bool
    var Options []ComboBoxOption
    var OnChange Action[string]?
    var Width float64
    var Disabled bool
    var Popup PopupInput

    func Build() Blob {
        let change = OnChange
        let outside = Popup
        return Interaction.RevealFocus(
            Container{
                Width: Width,
                MaxWidth: Percent(100),
                Gap: 6,
                Label{Content: Caption, Size: AppTheme.SmallSize, Muted: true}.Build(),
                Container{
                    Position: PositionType.Relative,
                    Cell.Mount[ComboBoxInput, ComboBox](
                        nil,
                        ComboBoxInput{
                            Items: Options,
                            SelectedId: Value,
                            Placeholder: Value != "" ? Value: Placeholder ?? "",
                            Searchable: Searchable,
                            SearchPlaceholder: "Search",
                            OnSelect: selected -> change?.Invoke(selected),
                            AccessibilityName: Caption,
                            Disabled: Disabled || Options.Length == 0,
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
                            CreateSearch: (input, search) -> {
                                let p = AppTheme.Current
                                search.BackgroundColor = p.Paper
                                search.Color = p.Ink
                                search.BorderColor = p.Line
                                search.FontFamily = AppTheme.BodyFont
                                search.FontSize = AppTheme.SmallSize
                                return search
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
                                popup.KeyBindings = outside.KeyBindings
                                popup.OnKeyDown = event -> outside.OnKeyDown?.Invoke(event)
                                popup.OnPointerDown = event -> outside.OnPointerDown?.Invoke(event)
                                return popup
                            },
                        }
                    ),
                    Container{
                        Position: PositionType.Absolute,
                        Right: 12,
                        Top: 0,
                        Bottom: 0,
                        JustifyContent: JustifyContent.Center,
                        HitTestSelf: false,
                        MaterialIcons.Create("expand_more", 20, AppTheme.Current.Muted),
                    },
                },
            }
        )
    }
}
