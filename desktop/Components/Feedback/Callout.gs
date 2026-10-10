package TokateDesktop

import Goo

/// A prominent status message on an accent-edged surface.
data struct Callout {
    var Message string

    func Build() Blob -> Container{
        Padding: 16,
        BackgroundColor: AppTheme.Current.Surface,
        BorderWidth: Edges{Left: 3},
        BorderColor: AppTheme.Current.Accent,
        Accessibility: Accessibility{Role: AccessibilityRole.Status, Name: Message},
        Label{Content: Message, Size: 18}.Build(),
    }
}
