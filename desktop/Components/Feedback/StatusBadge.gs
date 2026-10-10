package TokateDesktop

import Goo

/// A compact status label announced as a status to assistive technology.
data struct StatusBadge {
    var Value string

    func Build() Blob -> Container{
        Padding: Edges{Left: 12, Right: 12, Top: 7, Bottom: 7},
        BorderRadius: 4,
        BackgroundColor: AppTheme.Current.Paper,
        Accessibility: Accessibility{Role: AccessibilityRole.Status, Name: Value},
        Label{Content: Value, Size: 17}.Build(),
    }
}
