package TokateDesktop

import Goo
import System

/// The output of a donation. Before the start it is an empty panel. After the start it is an `ActivityLog`,
/// which keeps the scroll position, with the line count in its header.
data struct DonationRun {
    var Progress DonationProgress
    var Short bool
    var Button CommandButton

    func Build() Blob {
        let p = AppTheme.Current
        let count = Progress.Output.Count
        let summary = Progress.Truncated ? "Latest " + count.ToString() + " lines. Earlier lines are not shown.": count == 0 ? "": count.ToString() + (
            count == 1 ? " line": " lines"
        )
        let panel = Container{
            FlexGrow: Short ? 0: 1,
            FlexBasis: Short ? Length.Auto: Length(0),
            MinHeight: 0,
            Overflow: Overflow.Hidden,
            BackgroundColor: p.Surface,
            BorderWidth: 1,
            BorderColor: p.Line,
            BorderRadius: AppTheme.PanelRadius,
        }
        if !Progress.Started {
            panel.Children.Add(
                Container{
                    MinHeight: 52,
                    JustifyContent: JustifyContent.Center,
                    Padding: Edges{Left: 22, Right: 22},
                    Heading{Content: "Output", Size: AppTheme.ItemSize}.Build(),
                }
            )
            panel.Children.Add(Rule{}.Build())
            panel.Children.Add(
                Container{
                    FlexGrow: 1,
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.Center,
                    Padding: 24,
                    Label{Content: "The output shows here after the donation starts.", Muted: true}.Build(),
                }
            )
            return panel
        }
        panel.Children.Add(
            ActivityLog.Mount(
                "donation-output",
                ActivityLogInput{
                    Lines: Progress.Output,
                    Revision: Progress.OutputRevision,
                    Placeholder: Progress.Running ? "Starting donation...": "The donation gave no output.",
                    Name: "Donation output",
                    LineName: "Command output",
                    Running: Progress.Running,
                    Short: Short,
                    Leading: () -> []Blob{
                        Heading{Content: "Output", Size: AppTheme.ItemSize}.Build(),
                        Label{Content: summary, Size: AppTheme.SmallSize, Muted: true}.Build(),
                    },
                    FollowButton: Button,
                }
            )
        )
        return panel
    }
}
