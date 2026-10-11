package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The donor's page: choose an issue, set limits, review, then reserve and run the donation.
class DonateView {
    private let donation DonationService
    private let feedback FeedbackService
    private let issue IssueStepView
    private let limits LimitsStepView
    private let review ReviewStepView
    private let progress DonationStepView

    init(donation DonationService, feedback FeedbackService, navigate Action[Destination], openSaved Action[string]) {
        this.donation = donation
        this.feedback = feedback
        issue = IssueStepView(donation)
        limits = LimitsStepView(donation)
        review = ReviewStepView(donation)
        progress = DonationStepView(donation, navigate, openSaved)
    }

    /// Identifies the step so each starts at the top.
    prop Key string -> "Donate" + DonationSteps.Index(donation.Current.Step).ToString()

    prop IsDonating bool -> donation.IsDonating

    prop IsLive bool -> donation.IsLive

    prop IsBrowsing bool -> donation.IsBrowsing

    func Build(page PageContext) Blob {
        let step = donation.Current.Step
        let message = feedback.Current.Message
        if step == DonationStep.Donation {
            return progress.Build(page, Header(step), message)
        }
        let body = List[Blob]{Header(step)}
        if message != "" {
            body.Add(Callout{Message: message, Tone: feedback.Current.Tone}.Build())
        }
        if step == DonationStep.Issue {
            body.AddRange(issue.Build(page))
        } else if step == DonationStep.Limits {
            body.AddRange(limits.Build(page))
        } else {
            body.AddRange(review.Build(page))
        }
        return Stack{Gap: 20, Children: body.ToArray()}.Build()
    }

    private func Header(step DonationStep) Blob -> Stack{
        Gap: 18,
        Children: []Blob{
            Heading{Content: DonationSteps.Heading(step), Size: AppTheme.DisplaySize}.Build(),
            StepIndicator{
                Names: DonationSteps.Names,
                Numerals: DonationSteps.Numerals,
                Current: DonationSteps.Index(step),
            }.Build(),
        },
    }.Build()
}
