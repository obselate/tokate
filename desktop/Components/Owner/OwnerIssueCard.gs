package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System
import System.Collections.Generic

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
    var Compact bool
    var Button CommandButton
    var OnApproval Action?
    var OnReview Action[string]?
    var OnChecks Action[string]?

    func Build() Blob {
        let p = AppTheme.Current
        let number = Issue.NumberText
        let stale = Work?.NeedsApproval ?? false
        let approved = Issue.IsApproved && !stale
        let look = AppTheme.Look(approved ? Tone.Done: Tone.Wait)
        let approval = Panel{
            Compact: Compact,
            Children: []Blob{
                Row{
                    Gap: 16,
                    Children: []Blob{
                        MaterialIcons.Create(approved ? "task_alt": "radio_button_unchecked", 26, look.Edge),
                        Container{
                            FlexGrow: 1,
                            FlexBasis: 0,
                            MinWidth: 200,
                            Gap: 2,
                            Heading{Content: stale ? "Fresh owner approval required": approved ? "Approved for donation": "Not approved for donation", Size: AppTheme.ItemSize}.Build(),
                            Label{
                                Content: stale ? Work!!.NextAction: approved ?
                                    "The tokate:approved label permits donors with access to reserve this issue.": "Donors cannot reserve this issue.",
                                Size: AppTheme.SmallSize,
                                Muted: true,
                            }.Build(),
                        },
                        (Button with{
                            Label = stale ? "Re-approve issue #" + number: approved ? "Revoke approval #" + number: "Approve issue #" + number,
                            OnClick = OnApproval,
                            Primary = !approved,
                            Disabled = !CanWrite || (!approved && !SupportsApproval),
                        }).Build(),
                    },
                }.Build(),
            },
        }.Build()
        approval.Children.Add(Label{
            Content: "Approval binds verification, checks, protected paths, tool models, runtime limits and reservation duration. " +
                "Changes to these task fields, the issue text or the PR template need fresh approval. Descriptive policy edits do not.",
            Size: AppTheme.SmallSize,
            Muted: true,
        }.Build())
        if !stale && (Work?.NextAction ?? "") != "" {
            approval.Children.Add(Label{Content: Work!!.NextAction, Size: AppTheme.SmallSize}.Build())
        }
        let drafts = Work?.Drafts ?? []string{}
        let lines = List[Blob]()
        for draft in drafts {
            lines.Add(Draft(draft))
        }
        if Reading {
            let line = ListRow{Children: []Blob{Label{Content: "Reading the contribution", Muted: true}.Build()}}.Build()
            line.Opacity = AppTheme.Motion ? Button.Pulse: 1
            lines.Add(line)
        } else if lines.Count == 0 {
            lines.Add(ListRow{Children: []Blob{Label{Content: "No draft pull requests.", Muted: true}.Build()}}.Build())
        }
        return Stack{
            Gap: 16,
            Children: []Blob{
                approval,
                SectionPanel{
                    Title: "Draft pull requests",
                    Count: Reading ? -1: drafts.Length,
                    Children: lines.ToArray(),
                    Note: "Before you accept a pull request: verify the receipt, make sure that CI is green on the reviewed commit, and read the diff. You merge on GitHub.",
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
                Container{Width: 84, FlexShrink: 0, Label{Content: "PR #" + pr}.Build()},
                Result(known.Receipt == "" ? "Receipt not checked": "Receipt " + known.Receipt, known.Receipt == "", known.ReceiptTone),
                Result(known.Ci == "" ? "CI not checked": "CI " + known.Ci, known.Ci == "", known.CiTone),
                Spacer{}.Build(),
                (Button with{Label = "Check receipt and CI", Name = "Check PR #" + pr, OnClick = () -> checks?.Invoke(pr)}).Build(),
                (Button with{
                    Label = "Review",
                    Name = "Review PR #" + pr,
                    Kind = ButtonKind.Quiet,
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
            Width: 178,
            FlexShrink: 0,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 6,
            MaterialIcons.Create(
                unchecked ? "radio_button_unchecked": tone == Tone.Done ? "check_circle": tone == Tone.Fail ? "error": "schedule",
                18,
                look.Edge
            ),
            Label{Content: text, Size: AppTheme.SmallSize, Ink: look.Edge}.Build(),
        }
    }
}
