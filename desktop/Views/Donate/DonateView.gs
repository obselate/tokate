package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The donor's page: choose an issue, set limits, review, then reserve and run the donation.
class DonateView {
    private let donation DonationService
    private let issue IssueStepView
    private let limits LimitsStepView
    private let review ReviewStepView
    private let progress DonationStepView

    init(
        donation DonationService,
        art ArtworkService,
        navigate Action[Destination],
        openSaved Action[string]
    ) {
        this.donation = donation
        issue = IssueStepView(donation)
        limits = LimitsStepView(donation, art, () -> navigate(Destination.Profiles))
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
        if step == DonationStep.Donation {
            return progress.Build(page, Header(page, step))
        }
        let body = List[Blob]()
        if step == DonationStep.Issue {
            body.AddRange(issue.Build(page))
        } else if step == DonationStep.Limits {
            body.AddRange(limits.Build(page))
        } else {
            body.AddRange(review.Build(page))
        }
        return page.Layout(Header(page, step), body.ToArray())
    }

    /// The page title and the step indicator. Step IV names the issue and links to it.
    private func Header(page PageContext, step DonationStep) Blob {
        let state = donation.Current
        let run = state.Progress.Run
        let repository = state.Progress.Path != "" ? run.Repo: state.Repository
        let number = state.Progress.Path != "" ? run.Issue.ToString(): state.Issue
        let identity = state.RepositoryMode ? state.Repository: repository + " #" + number
        let titled = step == DonationStep.Donation && state.IssueTitle != "" && identity == state.Identity
        let children = List[Blob]{
            Heading{
                Content: titled ? state.IssueTitle: DonationSteps.Heading(step),
                Size: AppTheme.DisplaySize,
                MaxLines: 2,
            }.Build(),
        }
        if step == DonationStep.Donation && !state.RepositoryMode {
            children.Add(
                Row{
                    Children: []Blob{
                        Label{Content: identity, Size: AppTheme.SmallSize, Muted: true}.Build(),
                        (page.Button with{
                            Label = "Open issue",
                            Icon = "open_in_new",
                            AllowWhileBusy = true,
                            OnClick = () -> Browser.Open("https://github.com/" + repository + "/issues/" + number),
                        }).Build(),
                    },
                }.Build()
            )
        }
        children.Add(
            StepIndicator{
                Names: DonationSteps.Names,
                Numerals: DonationSteps.Numerals,
                Current: DonationSteps.Index(step),
            }.Build()
        )
        return Stack{Gap: AppTheme.Space16, Children: children.ToArray()}.Build()
    }
}
