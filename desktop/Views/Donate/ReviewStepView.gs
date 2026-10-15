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
                Label{Content: state.Consent.Contains("Gratis mode. No owner approved the task.") ? "Mode: Gratis": "Mode: Owner policy"}.Build(),
                Callout{Message: state.Consent, Tone: Tone.Need}.Build(),
                Row{Children: []Blob{
                    (page.Button with{Label = "Change details", OnClick = () -> donation.ChangeDetails()}).Build(),
                    (page.Button with{Label = "Start donating", OnClick = () -> donation.StartRepository(), Primary = true}).Build(),
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
                Compact: page.CompactPanels,
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
