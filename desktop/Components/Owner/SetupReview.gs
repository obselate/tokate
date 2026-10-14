package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// A setup summary, its GitHub preview, and the confirmed setup PR.
data struct SetupReview {
    var Repository string
    var CommandCount int32
    var CheckCount int32
    var Contributors string
    var Harnesses string
    var Models string
    /// The time limit of a donation, or "" when the policy has none.
    var Limit string
    var Written string
    var Report SetupReport
    var Previewed bool
    var Disabled bool
    var Compact bool
    var Button CommandButton
    var OnApply Action?
    var OnPreview Action?

    func Build() Blob {
        let facts = List[Blob]{
            DetailRow{Caption: "Repository", Value: Repository}.Build(),
            DetailRow{
                Caption: "Checks",
                Value: (CommandCount == 1 ? "1 command": CommandCount.ToString() + " commands") + ", " + (
                    CheckCount == 1 ? "1 CI check": CheckCount.ToString() + " CI checks"
                ),
            }.Build(),
            DetailRow{Caption: "Contributors", Value: Contributors}.Build(),
            DetailRow{Caption: "Harnesses", Value: Harnesses}.Build(),
            DetailRow{Caption: "Models", Value: Models}.Build(),
        }
        if Limit != "" {
            facts.Add(DetailRow{Caption: "Time limit", Value: Limit}.Build())
        }
        let review = Panel{
            Compact: Compact,
            Children: []Blob{
                IconHeading{
                    Icon: "folder_open",
                    Content: "Project setup",
                    Detail: "Tokate opens a setup PR with version 3 policy, per-tool model permissions and the coordinator pin update. " +
                        "Preview first, then apply GitHub settings. Review and merge the PR before approving work.",
                }.Build(),
                Rule{}.Build(),
                Stack{Gap: 10, Children: facts.ToArray()}.Build(),
                Row{
                    Children: []Blob{
                        (Button with{Label = "Preview setup", OnClick = OnPreview, Primary = !Previewed}).Build(),
                        (Button with{Label = "Apply setup", OnClick = OnApply, Primary = Previewed, Disabled = !Previewed || Report.Applied}).Build(),
                    },
                }.Build(),
            },
        }.Build()
        for step in Report.Manual ?? []string{} {
            review.Children.Add(Label{Content: "Manual: " + step, Size: AppTheme.SmallSize}.Build())
        }
        if !String.IsNullOrEmpty(Report.PullRequest) {
            review.Children.Add((Button with{
                Label = "Open setup PR", Icon = "open_in_new", Kind = ButtonKind.Quiet,
                AllowWhileBusy = true, OnClick = () -> Browser.Open(Report.PullRequest),
            }).Build())
        }
        if Written != "" {
            review.Children.Add(ReportText{Content: Written, MaxHeight: 420}.Build())
        }
        return review
    }
}
