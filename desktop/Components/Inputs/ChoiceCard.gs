package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System

/// A large selectable card with an icon, title, optional detail line and check mark.
data struct ChoiceCard {
    var Title string
    var Detail string
    var Icon string
    /// Artwork that replaces the icon.
    var Art Blob?
    var Selected bool
    var OnChoose Action?
    var Disabled bool
    /// A low card for a row of choices. Its detail shows at the end of the line, in place of the check mark.
    var Compact bool

    func Build() Blob {
        let p = AppTheme.Current
        let choose = OnChoose
        let text = Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Gap: AppTheme.Space4, Heading{Content: Title, Size: AppTheme.ItemSize}.Build()}
        let note = Label{Content: Detail, Size: AppTheme.SmallSize, Muted: true}.Build()
        if Detail != "" && !Compact {
            text.Children.Add(note)
        }
        var end Blob = MaterialIcons.Create("check_circle", 18, Selected ? p.Accent: Color.Transparent)
        if Detail != "" && Compact {
            end = note
        }
        var mark Blob = MaterialIcons.Create(Icon, 24, p.Accent)
        if let art = Art {
            mark = Container{Width: 24, Height: 24, FlexShrink: 0, art}
        }
        return Interaction.Keyboard(
            Button{
                FlexGrow: 1,
                FlexBasis: 0,
                MinWidth: Compact ? AppTheme.CompactChoiceMinWidth: AppTheme.ChoiceMinWidth,
                MinHeight: AppTheme.RowHeight,
                Padding: AppTheme.CardPadding,
                Gap: AppTheme.Space12,
                AlignSelf: AlignSelf.Stretch,
                AlignItems: AlignItems.FlexStart,
                BackgroundColor: Selected ? p.Paper: p.Surface,
                BorderWidth: Selected ? 2: 1,
                BorderColor: Selected ? p.Accent: p.Line,
                BorderRadius: AppTheme.PanelRadius,
                Disabled: Disabled,
                Focusable: true,
                Focus: AppTheme.FocusStyle(),
                Hover: Style{BorderColor: p.Accent},
                Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: Title, Description: Detail ?? ""},
                OnClick: () -> choose?.Invoke(),
                Container{
                    Width: Percent(100),
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space12,
                    mark,
                    text,
                    end,
                },
            }
        )
    }
}
