package TokateDesktop

import Goo
import System
import System.Collections.Generic

class ReviewStepView {
    private let donation DonationService

    init(donation DonationService) { this.donation = donation }

    func Build(page PageContext) []Blob {
        let state = donation.Current
        if !state.RepositoryMode {
            return []Blob{
                DonationSummary{Repository: state.Repository, Issue: state.Issue, Title: state.IssueTitle, Account: state.Account, Draft: state.Draft, Models: state.Catalog()}.Build(),
                ActionBar{Children: []Blob{
                    (page.Button with{Label = "Change details", OnClick = () -> donation.ChangeDetails()}).Build(),
                    (page.Button with{Label = "Reserve contribution", OnClick = () -> donation.Reserve(), Primary = true}).Build(),
                }}.Build(),
            }
        }
        let draft = state.Draft
        let guidance = List[Blob]()
        for item in state.ConsentFact("Guidance", state.Prompt == "" ? "Repository guidance files": state.Prompt).Split(',') {
            if item.Trim() != "" { guidance.Add(StatusChip{Value: item.Trim(), Tone: Tone.Wait, Icon: ""}.Build()) }
        }
        return []Blob{
            Panel{Name: "Donation consent", Children: []Blob{
                IconHeading{Icon: "volunteer_activism", Content: "Donation consent"}.Build(),
                Stack{Gap: AppTheme.Space12, Children: []Blob{
                    Heading{Content: "Repository and mode", Size: AppTheme.ItemSize}.Build(),
                    DetailRow{Caption: "Repository", Value: state.Repository}.Build(),
                    DetailRow{Caption: "Mode", Value: state.Policy.Loaded ? "Owner policy": "Gratis"}.Build(),
                }}.Build(),
                Rule{}.Build(),
                Stack{Gap: AppTheme.Space12, Children: []Blob{
                    Heading{Content: "Runner", Size: AppTheme.ItemSize}.Build(),
                    DetailRow{Caption: "Harness", Value: ModelChoice.Tool(draft.Harness, draft.Provider)}.Build(),
                    DetailRow{Caption: "Model", Value: Array.Find(state.Catalog(), model -> model.Slug == draft.Model).DisplayName ?? draft.Model}.Build(),
                    DetailRow{Caption: "Effort", Value: ModelChoice.EffortLabel(draft.Effort)}.Build(),
                    draft.Harness == "pi" ? DetailRow{Caption: "Endpoint", Value: draft.Endpoint}.Build(): Stack{Children: []Blob{}}.Build(),
                }}.Build(),
                Rule{}.Build(),
                Stack{Gap: AppTheme.Space12, Children: []Blob{
                    Heading{Content: "Time", Size: AppTheme.ItemSize}.Build(),
                    DetailRow{Caption: "Per task", Value: DurationText.Format(int32.Parse(state.PerTask))}.Build(),
                    DetailRow{Caption: "Total", Value: state.IssueList != "" ? state.ConsentFact("Total", "Selected issues"): state.Total == "" ? "Until stopped": DurationText.Format(int32.Parse(state.Total))}.Build(),
                }}.Build(),
                Rule{}.Build(),
                Stack{Gap: AppTheme.Space12, Children: []Blob{
                    Heading{Content: "Scope and publishing", Size: AppTheme.ItemSize}.Build(),
                    DetailRow{Caption: "Issues", Value: String.IsNullOrWhiteSpace(state.IssueList) ? "Harness chooses": "#" + state.IssueList.Replace(",", ", #")}.Build(),
                    DetailRow{Caption: "Publishing", Value: state.ReviewEach ? "Review each pull request": "Automatic draft pull requests"}.Build(),
                    DetailRow{Caption: "Guidance", Children: guidance.ToArray()}.Build(),
                }}.Build(),
                (page.Button with{Label = state.ShowConsent ? "Hide exact consent": "Show exact consent", OnClick = () -> donation.ToggleConsent()}).Build(),
                state.ShowConsent ? Label{Content: state.Consent, Size: AppTheme.SmallSize, Mono: true}.Build(): Stack{Children: []Blob{}}.Build(),
            }}.Build(),
            ActionBar{Children: []Blob{
                (page.Button with{Label = "Change details", OnClick = () -> donation.ChangeDetails()}).Build(),
                (page.Button with{Label = "Start donating", OnClick = () -> donation.StartRepository(), Primary = true, Disabled = state.Consent == "" || state.ReviewedArguments.Length == 0}).Build(),
            }}.Build(),
        }
    }
}
