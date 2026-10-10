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
        return []Blob{
            DonationSummary{
                Repository: state.Repository,
                Issue: state.Issue,
                Title: state.IssueTitle,
                Account: state.Account,
                Draft: state.Draft,
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
