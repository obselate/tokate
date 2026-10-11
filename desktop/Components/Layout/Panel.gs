package TokateDesktop

import Goo

/// A bordered surface that groups related content. Compact panels use tighter padding.
data struct Panel {
    var Children []Blob
    var Compact bool
    var Name string?

    func Build() Container {
        let panel = Container{
            Padding: Compact ? 20: 28,
            Gap: 18,
            BackgroundColor: AppTheme.Current.Surface,
            BorderWidth: 1,
            BorderColor: AppTheme.Current.Line,
            BorderRadius: AppTheme.PanelRadius,
            Children: Children ?? []Blob{},
        }
        if let name = Name {
            panel.Accessibility = Accessibility{Role: AccessibilityRole.Group, Name: name}
        }
        return panel
    }
}
