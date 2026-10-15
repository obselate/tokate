package TokateDesktop

import Goo
import Goo.Widgets.Icons

/// A compact status label in the colors of its tone, announced as a status to assistive technology.
data struct StatusChip {
    var Value string
    var Tone Tone
    var Icon string?

    func Build() Blob {
        let look = AppTheme.Look(Tone)
        let badge = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            FlexShrink: 0,
            Gap: AppTheme.Space8,
            Padding: Edges{Left: AppTheme.Space8, Right: AppTheme.Space8, Top: AppTheme.Space4, Bottom: AppTheme.Space4},
            BorderRadius: AppTheme.ControlRadius,
            BorderWidth: 1,
            BorderColor: look.Line,
            BackgroundColor: look.Fill,
            Accessibility: Accessibility{Role: AccessibilityRole.Status, Name: Value},
            Label{Content: Value, Size: AppTheme.SmallSize, Ink: look.Ink}.Build(),
        }
        let icon = Icon ?? look.Icon
        if icon != "" {
            badge.Children.Insert(0, MaterialIcons.Create(icon, 16, look.Ink))
        }
        return badge
    }
}
