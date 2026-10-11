package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// One issue's approval and contribution state with the owner's actions for it and its draft PRs.
data struct OwnerIssueCard {
    var Issue Issue
    var Work IssueWork?
    var CanWrite bool
    var SupportsApproval bool
    var Compact bool
    var Button CommandButton
    var OnRefresh Action?
    var OnOpen Action?
    var OnApproval Action?
    var OnReview Action[string]?
    var OnVerify Action[string]?
    var OnChecks Action[string]?

    func Build() Blob {
        let number = Issue.NumberText
        let approved = Issue.IsApproved
        let review = OnReview
        let verify = OnVerify
        let checks = OnChecks
        let status = Work != nil ? Work!!.State.Replace('_', ' '): approved ? "Approved": "Needs approval"
        let actions = List[Blob]{
            (Button with{Label = "Refresh contribution", Kind = ButtonKind.Quiet, OnClick = OnRefresh}).Build(),
            (Button with{Label = "Open issue #" + number, Kind = ButtonKind.Quiet, Icon = "open_in_new", OnClick = OnOpen}).Build(),
            (Button with{
                Label = approved ? "Revoke approval #" + number: "Approve issue #" + number,
                OnClick = OnApproval,
                Primary = !approved,
                Disabled = !CanWrite || (!approved && !SupportsApproval),
            }).Build(),
        }
        for draft in Work?.Drafts ?? []string{} {
            let pr = draft
            actions.Add((Button with{Label = "Review PR #" + pr, Kind = ButtonKind.Quiet, Icon = "open_in_new", OnClick = () -> review?.Invoke(pr)}).Build())
            actions.Add((Button with{Label = "Verify PR #" + pr, OnClick = () -> verify?.Invoke(pr)}).Build())
            actions.Add((Button with{Label = "Check CI #" + pr, OnClick = () -> checks?.Invoke(pr)}).Build())
        }
        return Panel{
            Compact: Compact,
            Children: []Blob{
                Row{
                    Children: []Blob{
                        Heading{Content: "#" + number + "  " + Issue.Title}.Build(),
                        StatusBadge{Value: status, Tone: Statuses.ToneOf(status)}.Build(),
                    },
                }.Build(),
                Row{Children: actions.ToArray()}.Build(),
            },
        }.Build()
    }
}
