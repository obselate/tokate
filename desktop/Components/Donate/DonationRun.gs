package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System

/// A started donation: its state and budget above the live output, with elapsed time and the next actions
/// in the footer. The output is an `ActivityLog`, which keeps the scroll position.
data struct DonationRun {
    var Progress DonationProgress
    var Short bool
    var Button CommandButton
    var OnNew Action?
    var OnViewSaved Action?

    func Build() Blob {
        let p = AppTheme.Current
        let run = Progress.Run
        let button = Button
        let running = Progress.Running
        let elapsed = "Elapsed " + DonationProgress.ElapsedText(Progress.Elapsed)
        let start = OnNew
        let saved = OnViewSaved
        return Container{
            FlexGrow: 1,
            FlexBasis: 0,
            MinHeight: 0,
            Overflow: Overflow.Hidden,
            BackgroundColor: p.Surface,
            BorderWidth: 1,
            BorderColor: p.Line,
            BorderRadius: 5,
            Container{
                Padding: Edges{Left: 18, Right: 18, Top: 14, Bottom: 14},
                Accessibility: Accessibility{Role: AccessibilityRole.Status, Name: Progress.State, Busy: Progress.Running},
                Row{
                    Children: []Blob{
                        MaterialIcons.Create(Progress.Running ? "auto_awesome": "task_alt", 24, p.Accent),
                        Heading{Content: Progress.State, Size: 28}.Build(),
                    },
                }.Build(),
                Label{
                    Content: "Coding: " + run.CodingTime + "   /   Verification: " + run.VerificationTime,
                    Size: 16,
                    Muted: true,
                }.Build(),
            },
            Rule{}.Build(),
            ActivityLog.Mount(
                "donation-output",
                ActivityLogInput{
                    Lines: Progress.Output,
                    Revision: Progress.OutputRevision,
                    Placeholder: "Starting donation...",
                    Name: "Donation output",
                    LineName: "Command output",
                    Running: Progress.Running,
                    Short: Short,
                    Leading: () -> []Blob{Label{Content: elapsed, Size: 17, Muted: true}.Build()},
                    Trailing: () -> running ? []Blob{CancelButton{Stopping: button.Stopping, OnCancel: button.OnCancel}.Build()}:
                    []Blob{
                        (button with{Label = "New donation", OnClick = start}).Build(),
                        (button with{Label = "View saved work", OnClick = saved}).Build(),
                    },
                    FollowButton: Button,
                }
            ),
        }
    }
}
