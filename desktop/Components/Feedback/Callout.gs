package TokateDesktop

import Goo
import Goo.Widgets.Icons

/// A prominent message on a surface with an edge and icon in the colors of its tone.
data struct Callout {
    var Message string
    var Tone Tone

    func Build() Blob {
        let look = AppTheme.Look(Tone)
        return Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.FlexStart,
            Gap: 10,
            Padding: 16,
            BackgroundColor: AppTheme.Current.Surface,
            BorderWidth: Edges{Left: 3},
            BorderColor: look.Edge,
            Accessibility: Accessibility{Role: AccessibilityRole.Status, Name: Message},
            MaterialIcons.Create(look.Icon == "" ? "info": look.Icon, 20, look.Edge),
            Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Label{Content: Message}.Build()},
        }
    }
}
