package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System

/// One repository the owner can open, with its description.
data struct ProjectRow {
    var Project ProjectChoice
    var Disabled bool
    var OnChoose Action[string]?

    func Build() Blob {
        let p = AppTheme.Current
        let choose = OnChoose
        let repository = Project.Repository
        let copy = Container{
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            Gap: 3,
            Heading{Content: repository, Size: AppTheme.ItemSize, MaxLines: 1}.Build(),
        }
        if Project.Description != "" {
            let description = Label{Content: Project.Description, Size: AppTheme.SmallSize, Muted: true}.Build()
            description.TextMaxLines = 1
            copy.Children.Add(description)
        }
        return Interaction.Keyboard(
            Button{
                MinHeight: 64,
                Padding: Edges{Left: 20, Right: 12, Top: 10, Bottom: 10},
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 12,
                BorderWidth: 0,
                BackgroundColor: Color.Transparent,
                Hover: Style{BackgroundColor: p.Paper},
                Focus: AppTheme.FocusStyle(),
                Focusable: true,
                Disabled: Disabled,
                Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: "Open " + repository},
                OnClick: () -> choose?.Invoke(repository),
                copy,
                MaterialIcons.Create("chevron_right", 20, p.Muted),
            }
        )
    }
}
