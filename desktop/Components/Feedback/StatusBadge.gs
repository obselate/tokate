package TokateDesktop

import Goo
import Goo.Widgets.Icons

/// A compact status label in the colors of its tone, announced as a status to assistive technology.
data struct StatusBadge {
    var Value string
    var Tone Tone

    func Build() Blob {
        let look = AppTheme.Look(Tone)
        let badge = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            FlexShrink: 0,
            Gap: AppTheme.Space8,
            Padding: Edges{Left: AppTheme.Space12, Right: AppTheme.Space12, Top: AppTheme.Space8, Bottom: AppTheme.Space8},
            BorderRadius: AppTheme.ControlRadius,
            BorderWidth: 1,
            BorderColor: look.Line,
            BackgroundColor: look.Fill,
            Accessibility: Accessibility{Role: AccessibilityRole.Status, Name: Value},
            Label{Content: Value, Size: AppTheme.SmallSize, Ink: look.Ink}.Build(),
        }
        if look.Icon != "" {
            badge.Children.Insert(0, MaterialIcons.Create(look.Icon, 16, look.Ink))
        }
        return badge
    }
}
