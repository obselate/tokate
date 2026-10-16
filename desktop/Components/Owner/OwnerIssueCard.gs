package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System
import System.Collections.Generic
import System.Text.RegularExpressions

/// One issue for its owner: the approval with its action, then one line for each draft pull request with
/// the last receipt and CI results and the actions to check and review it.
data struct OwnerIssueCard {
    var Issue Issue
    var Work IssueWork?
    /// Whether the status of the issue is being read for the first time.
    var Reading bool
    var Reviews []DraftReview
    var CanWrite bool
    var SupportsApproval bool
    var Button CommandButton
    var OnApproval Action?
    var OnReview Action[string]?
    var Repository string
    var OnChecks Action[string]?

    func Build() Blob {
        let p = AppTheme.Current
        let number = Issue.NumberText
        let stale = Work?.NeedsApproval ?? false
        let approved = Issue.IsApproved && !stale
        let look = AppTheme.Look(approved ? Tone.Done: Tone.Wait)
        let approval = Panel{
            Children: []Blob{
                Row{
                    Gap: AppTheme.Space16,
                    Children: []Blob{
                        MaterialIcons.Create(approved ? "task_alt": "radio_button_unchecked", 26, look.Edge),
                        Container{
                            FlexGrow: 1,
                            FlexBasis: 0,
                            MinWidth: AppTheme.ShortFieldWidth,
                            Gap: AppTheme.Space4,
                            Heading{Content: stale ? "Approval expired": approved ? "Approved for donation": "Needs approval", Size: AppTheme.ItemSize}.Build(),
                            Label{
                                Content: stale ? Work!!.NextAction: approved ?
                                    "Donors with access can reserve this issue.": "Approve this issue to let donors reserve it.",
                                Size: AppTheme.SmallSize,
                                Muted: true,
                            }.Build(),
                        },
                        (Button with{
                            Label = stale ? "Re-approve issue #" + number: approved ? "Revoke approval #" + number: "Approve issue #" + number,
                            OnClick = OnApproval,
                            Primary = !approved,
                            Tone = approved ? ButtonTone.Danger: ButtonTone.Positive,
                            Disabled = !CanWrite || (!approved && !SupportsApproval),
                        }).Build(),
                    },
                }.Build(),
            },
        }.Build()
        approval.Children.Add(Label{
            Content: "Task or issue changes require fresh approval.",
            Size: AppTheme.SmallSize,
            Muted: true,
        }.Build())
        if !stale && (Work?.NextAction ?? "") != "" {
            approval.Children.Add(Label{Content: Work!!.NextAction, Size: AppTheme.SmallSize}.Build())
        }
        if Work?.CoordinatorFailed ?? false {
            let url = Regex.Match(Work!!.NextAction, "https://github\\.com/[^\\s]+/actions/runs/[0-9]+").Value
            approval.Children.Add(ActionBar{Children: []Blob{
                (Button with{
                    Label = "Re-run in Actions",
                    Icon = "open_in_new",
                    OnClick = () -> Browser.Open(url == "" ? "https://github.com/" + Repository + "/actions": url),
                }).Build(),
            }}.Build())
        }
        let drafts = Work?.Drafts ?? []string{}
        let lines = List[Blob]()
        for draft in drafts {
            lines.Add(Draft(draft))
        }
        if Reading {
            lines.Add(ListRow{Children: []Blob{Loader{Message: "Reading the contribution", Key: "owner-contribution"}.Build()}}.Build())
        } else if lines.Count == 0 {
            lines.Add(ListRow{Children: []Blob{Label{Content: "No draft pull requests", Muted: true}.Build()}}.Build())
        }
        return Stack{
            Gap: AppTheme.Space16,
            Children: []Blob{
                approval,
                ListSection{
                    Title: "Draft pull requests",
                    Count: Reading ? -1: drafts.Length,
                    Children: lines.ToArray(),
                    Note: "Check the receipt, review the diff and require green CI on the reviewed commit. Merge on GitHub.",
                }.Build(),
            },
        }.Build()
    }

    private func Draft(pr string) Blob {
        let review = OnReview
        let checks = OnChecks
        var known = DraftReview{Pr: pr, Receipt: "", Ci: ""}
        for item in Reviews {
            if item.Pr == pr {
                known = item
            }
        }
        return ListRow{
            Children: []Blob{
                Container{Width: AppTheme.ButtonMinWidth, FlexShrink: 0, Label{Content: "PR #" + pr}.Build()},
                Result(known.NeedsAmendment ? "Donor must amend": known.Receipt == "" ? "Receipt not checked": "Receipt " + known.Receipt, !known.NeedsAmendment && known.Receipt == "", known.NeedsAmendment ? Tone.Need: known.ReceiptTone),
                Result(known.Ci == "" ? "CI not checked": "CI " + known.Ci, known.Ci == "", known.CiTone),
                Spacer{}.Build(),
                (Button with{Label = "Check receipt and CI", Name = "Check PR #" + pr, OnClick = () -> checks?.Invoke(pr)}).Build(),
                (Button with{
                    Label = "Review",
                    Name = "Review PR #" + pr,
                    Icon = "open_in_new",
                    OnClick = () -> review?.Invoke(pr),
                }).Build(),
            },
        }.Build()
    }

    /// One result in a column of fixed width, so the results of all lines align.
    private func Result(text string, unchecked bool, tone Tone) Blob {
        let look = AppTheme.Look(tone)
        return Container{
            Width: AppTheme.ShortFieldWidth,
            FlexShrink: 0,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: AppTheme.Space8,
            MaterialIcons.Create(
                unchecked ? "radio_button_unchecked": tone == Tone.Done ? "check_circle": tone == Tone.Fail ? "error": "schedule",
                18,
                look.Edge
            ),
            Label{Content: text, Size: AppTheme.SmallSize, Ink: look.Edge}.Build(),
        }
    }
}
