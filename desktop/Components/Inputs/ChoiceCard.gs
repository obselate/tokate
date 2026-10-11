package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System

/// A large selectable card with an icon, title and check mark.
data struct ChoiceCard {
    var Title string
    var Detail string
    var Icon string
    var Selected bool
    var OnChoose Action?
    var Disabled bool

    func Build() Blob {
        let p = AppTheme.Current
        let choose = OnChoose
        return Interaction.Keyboard(
            Button{
                FlexGrow: 1,
                FlexBasis: 0,
                MinWidth: 190,
                MinHeight: 82,
                Padding: 20,
                Gap: 10,
                AlignSelf: AlignSelf.Stretch,
                AlignItems: AlignItems.FlexStart,
                BackgroundColor: Selected ? p.Paper: p.Surface,
                BorderWidth: Selected ? 2: 1,
                BorderColor: Selected ? p.Accent: p.Line,
                BorderRadius: AppTheme.ControlRadius,
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
                    Gap: 12,
                    MaterialIcons.Create(Icon, 24, p.Accent),
                    Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Heading{Content: Title, Size: AppTheme.ItemSize}.Build()},
                    MaterialIcons.Create("check_circle", 18, Selected ? p.Accent: Color.Transparent),
                },
            }
        )
    }
}
