package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System

/// One selectable issue in an issue table, with up to three of its labels. `ShowApproval` adds a badge to
/// an approved issue.
data struct IssueRow {
    var Issue Issue
    var Disabled bool
    var ShowApproval bool
    /// The last row has no line below it.
    var Last bool
    var OnChoose Action?

    func Build() Blob {
        let p = AppTheme.Current
        let choose = OnChoose
        let number = Issue.NumberText
        let row = Button{
            Key: number,
            MinHeight: 52,
            Padding: Edges{Left: 14, Right: 6, Top: 6, Bottom: 6},
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 12,
            BorderWidth: Edges{Bottom: Last ? 0: 1},
            BorderColor: p.Line,
            BackgroundColor: Color.Transparent,
            Hover: Style{BackgroundColor: p.Paper},
            Focus: AppTheme.FocusStyle(),
            Focusable: true,
            Disabled: Disabled,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: "Issue #" + number + ": " + Issue.Title},
            OnClick: () -> choose?.Invoke(),
            Container{Width: 56, FlexShrink: 0, Label{Content: "#" + number, Muted: true}.Build()},
            Container{
                FlexGrow: 1,
                FlexBasis: 0,
                MinWidth: 0,
                Heading{Content: Issue.Title, Size: AppTheme.ItemSize, MaxLines: 2}.Build(),
            },
        }
        var shown = 0
        for label in Issue.Labels {
            if shown < 3 && !label.StartsWith("tokate:") {
                shown++
                row.Children.Add(
                    Container{
                        FlexShrink: 0,
                        Padding: Edges{Left: 8, Right: 8, Top: 2, Bottom: 2},
                        BorderWidth: 1,
                        BorderColor: p.Line,
                        BorderRadius: 12,
                        Label{Content: label, Size: AppTheme.CodeSize, Muted: true}.Build(),
                    }
                )
            }
        }
        if ShowApproval && Issue.IsApproved {
            row.Children.Add(StatusBadge{Value: "Approved", Tone: Tone.Done}.Build())
        }
        row.Children.Add(MaterialIcons.Create("chevron_right", 20, p.Muted))
        return Interaction.Keyboard(row)
    }
}
