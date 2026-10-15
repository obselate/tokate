package TokateDesktop

import Goo
import System

/// Step III: review the issue, budget and selection, then request a reservation.
class ReviewStepView {
    private let donation DonationService

    init(donation DonationService) {
        this.donation = donation
    }

    func Build(page PageContext) []Blob {
        let state = donation.Current
        if state.RepositoryMode {
            return []Blob{
                Heading{Content: state.Repository}.Build(),
                Panel{Name: "Donation consent", Children: []Blob{
                    DetailRow{Caption: "Mode", Value: state.Policy.Loaded ? "Owner policy": "Gratis"}.Build(),
                    DetailRow{Caption: "Harness", Value: state.ConsentFact("Harness", ModelChoice.Tool(state.Draft.Harness, state.Draft.Provider))}.Build(),
                    DetailRow{Caption: "Model", Value: state.ConsentFact("Model", state.Draft.Model)}.Build(),
                    DetailRow{Caption: "Effort", Value: state.ConsentFact("Effort", ModelChoice.EffortLabel(state.Draft.Effort))}.Build(),
                    DetailRow{Caption: "Per task", Value: DonationState.Duration(int32.Parse(state.PerTask))}.Build(),
                    DetailRow{Caption: "Total", Value: state.IssueList != "" ? state.ConsentFact("Total", "Selected issues"): state.Total == "" ? "Until stopped": DonationState.Duration(int32.Parse(state.Total))}.Build(),
                    DetailRow{Caption: "Issues", Value: String.IsNullOrWhiteSpace(state.IssueList) ? "Harness chooses": state.IssueList}.Build(),
                    DetailRow{Caption: "Publishing", Value: state.ReviewEach ? "Review each pull request": "Automatic draft pull requests"}.Build(),
                    DetailRow{Caption: "Guidance", Value: state.ConsentFact("Guidance", state.Prompt == "" ? "Repository guidance files": state.Prompt)}.Build(),
                    (page.Button with{Label = state.ShowConsent ? "Hide exact consent": "Show exact consent", Kind = ButtonKind.Quiet, OnClick = () -> donation.ToggleConsent()}).Build(),
                    state.ShowConsent ? Label{Content: state.Consent, Size: AppTheme.SmallSize, Mono: true}.Build(): Stack{Children: []Blob{}}.Build(),
                }}.Build(),
                Row{Children: []Blob{
                    (page.Button with{Label = "Change details", OnClick = () -> donation.ChangeDetails()}).Build(),
                    (page.Button with{Label = "Start donating", OnClick = () -> donation.StartRepository(), Primary = true, Disabled = state.Consent == "" || state.ReviewedArguments.Length == 0}).Build(),
                }}.Build(),
            }
        }
        return []Blob{
            DonationSummary{
                Repository: state.Repository,
                Issue: state.Issue,
                Title: state.IssueTitle,
                Account: state.Account,
                Draft: state.Draft,
                Models: state.Catalog(),
            }.Build(),
            Row{
                Children: []Blob{
                    (page.Button with{Label = "Change details", OnClick = () -> donation.ChangeDetails()}).Build(),
                    (page.Button with{Label = "Reserve contribution", OnClick = () -> donation.Reserve(), Primary = true}).Build(),
                },
            }.Build(),
        }
    }
}
