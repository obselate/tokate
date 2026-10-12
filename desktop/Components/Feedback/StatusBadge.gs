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
            Gap: 6,
            Padding: Edges{Left: 10, Right: 10, Top: 5, Bottom: 5},
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
