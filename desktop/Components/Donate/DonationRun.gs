package TokateDesktop

import Goo
import System

data struct DonationRun {
    var Progress DonationProgress
    var Short bool
    var Button CommandButton

    func Build() Blob {
        if !Progress.Started {
            return OutputPanel{Title: "Output", Children: []Blob{
                Container{Padding: AppTheme.Space24, Label{Content: "Output appears after the donation starts", Muted: true}.Build()},
            }}.Build()
        }
        return Container{
            FlexGrow: Short ? 0: 1,
            FlexBasis: Short ? Length.Auto: Length(0),
            MinHeight: 0,
            Overflow: Overflow.Hidden,
            BackgroundColor: AppTheme.Current.Surface,
            BorderWidth: 1,
            BorderColor: AppTheme.Current.Line,
            BorderRadius: AppTheme.PanelRadius,
            ActivityLog.Mount("donation-output", ActivityLogInput{
                Lines: Progress.Output,
                Revision: Progress.OutputRevision,
                Placeholder: Progress.Running ? "Waiting for task output": "No output recorded",
                Name: "Donation output", LineName: "Command output",
                Running: Progress.Running, Short: Short,
                Leading: () -> {
                    let header = OutputPanel{Title: "Output", LineCount: Progress.Output.Count, Elapsed: DonationProgress.Clock(Progress.Elapsed)}.Header()
                    header.Padding = 0
                    header.MinHeight = 0
                    return []Blob{header}
                },
                Trailing: () -> Progress.Truncated ? []Blob{Label{Content: "Earlier lines omitted", Muted: true, Size: AppTheme.SmallSize}.Build()}: []Blob{},
                FollowButton: Button,
            }),
        }
    }
}
