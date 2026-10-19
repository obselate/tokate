package TokateDesktop

import Goo
import System

/// A navigation destination. Wide rails show a vertical indicator; compact bars show a short caption with an
/// underline.
data struct NavItem {
    var Title string
    var Caption string
    var Selected bool
    var Compact bool
    var OnSelect Action?

    func Build() Blob {
        let p = AppTheme.Current
        let choose = OnSelect
        let button = Button{
            Height: AppTheme.ButtonHeight,
            FlexGrow: Compact ? 1: 0,
            FlexBasis: Compact ? Length(0): Length.Auto,
            MinWidth: 0,
            Padding: Edges{Left: Compact ? AppTheme.Space8: AppTheme.Space16, Right: Compact ? AppTheme.Space8: AppTheme.Space16},
            BorderRadius: AppTheme.ControlRadius,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space16,
            JustifyContent: Compact ? JustifyContent.Center: JustifyContent.FlexStart,
            BackgroundColor: Selected ? p.Surface: Color.Transparent,
            BorderWidth: 0,
            BorderColor: Color.Transparent,
            OnClick: () -> choose?.Invoke(),
            Focusable: true,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: Title},
            Hover: Style{BackgroundColor: p.Surface},
            Focus: AppTheme.FocusStyle(),
            Label{Content: Compact ? Caption: Title, Size: Compact ? AppTheme.SmallSize: AppTheme.BodySize}.Build(),
        }
        let indicator = Container{
            Position: PositionType.Absolute,
            Left: 0,
            BorderRadius: 1,
            BackgroundColor: Selected ? p.Accent: Color.Transparent,
        }
        if Compact {
            indicator.Right = 0
            indicator.Bottom = 0
            indicator.Height = 2
        } else {
            indicator.Top = AppTheme.Space8
            indicator.Bottom = AppTheme.Space8
            indicator.Width = 2
        }
        button.Children.Insert(0, indicator)
        return Interaction.Keyboard(button)
    }
}
