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
            Gap: AppTheme.Space4,
            Heading{Content: repository, Size: AppTheme.ItemSize, MaxLines: 1}.Build(),
        }
        if Project.Description != "" {
            copy.Children.Add(Label{Content: Project.Description, Size: AppTheme.SmallSize, Muted: true, MaxLines: 1}.Build())
        }
        return Interaction.Keyboard(
            Button{
                MinHeight: AppTheme.RowHeight,
                Padding: Edges{Left: AppTheme.Space24, Right: AppTheme.Space12, Top: AppTheme.Space12, Bottom: AppTheme.Space12},
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space12,
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
