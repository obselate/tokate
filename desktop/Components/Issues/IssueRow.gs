package TokateDesktop

import Goo
import System

/// One selectable issue in an issue table.
data struct IssueRow {
    var Issue Issue
    var Disabled bool
    var OnChoose Action?

    func Build() Blob {
        let p = AppTheme.Current
        let choose = OnChoose
        let number = Issue.NumberText
        return Interaction.Keyboard(
            Button{
                Key: number,
                MinHeight: 64,
                Padding: 12,
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 14,
                BorderWidth: Edges{Bottom: 1},
                BorderColor: p.Line,
                BackgroundColor: Color.Transparent,
                Hover: Style{BackgroundColor: p.Paper},
                Focus: AppTheme.FocusStyle(),
                Focusable: true,
                Disabled: Disabled,
                Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: "Issue #" + number + ": " + Issue.Title},
                OnClick: () -> choose?.Invoke(),
                Container{Width: 65, FlexShrink: 0, Label{Content: "#" + number, Muted: true}.Build()},
                Container{
                    FlexGrow: 1,
                    FlexBasis: 0,
                    MinWidth: 0,
                    Heading{Content: Issue.Title, Size: AppTheme.ItemSize, MaxLines: 2}.Build(),
                },
                StatusBadge{Value: Issue.IsApproved ? "Approved": "Open", Tone: Issue.IsApproved ? Tone.Done: Tone.Wait}.Build(),
            }
        )
    }
}
