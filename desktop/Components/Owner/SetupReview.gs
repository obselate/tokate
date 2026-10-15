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
        let actions = List[Blob]{
            (Button with{Label = "Preview setup", OnClick = OnPreview, Primary = !Previewed && !Report.Applied}).Build(),
        }
        if Report.Applied && !String.IsNullOrEmpty(Report.PullRequest) {
            actions.Add((Button with{
                Label = "Open setup PR", Icon = "open_in_new", Primary = true,
                AllowWhileBusy = true, OnClick = () -> Browser.Open(Report.PullRequest),
            }).Build())
        } else {
            actions.Add((Button with{Label = "Apply setup", OnClick = OnApply, Primary = Previewed && !Report.Applied, Disabled = !Previewed || Report.Applied}).Build())
        }
        let review = Panel{
            Children: []Blob{
                IconHeading{
                    Icon: "folder_open",
                    Content: "Project setup",
                    Detail: "Preview the changes, then open a setup PR. Merge it before approving work.",
                }.Build(),
                Rule{}.Build(),
                Stack{Gap: AppTheme.Space12, Children: facts.ToArray()}.Build(),
                Row{Children: actions.ToArray()}.Build(),
            },
        }.Build()
        for change in Report.Changes ?? []SetupChange{} {
            let value = "Current: " + (change.Current == "" ? "none": change.Current) + "\nProposed: " + change.Proposed
            review.Children.Add(change.Current.Contains('\n') || change.Proposed.Contains('\n') ?
                Stack{Gap: AppTheme.Space8, Children: []Blob{
                    Label{Content: change.Setting, Size: AppTheme.LabelSize, Muted: true}.Build(),
                    ReportText{Content: value, MaxHeight: AppTheme.ReportMaxHeight}.Build(),
                }}.Build():
                DetailRow{Caption: change.Setting, Value: value}.Build())
        }
        for step in Report.Manual ?? []string{} {
            review.Children.Add(Label{Content: "Manual: " + step, Size: AppTheme.SmallSize}.Build())
        }
        if Written != "" {
            review.Children.Add(ReportText{Content: Written, MaxHeight: AppTheme.ReportMaxHeight}.Build())
        }
        return review
    }
}
