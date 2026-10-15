package TokateDesktop

import Goo

/// A bordered surface that groups related content.
data struct Panel {
    var Children []Blob
    var Name string?

    func Build() Container {
        let panel = Container{
            Padding: AppTheme.CardPadding,
            Gap: AppTheme.SectionGap,
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
