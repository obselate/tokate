package TokateDesktop

import System

func DonationTests() {
    let changed = () -> { }
    let feedback = FeedbackService(changed)
    let navigation = NavigationService(changed)
    let window = WindowService(changed)
    let activity = ActivityService(window, navigation, feedback, changed)
    let donation = DonationService(
        CommandRunner(activity, feedback, navigation),
        activity,
        feedback,
        DialogService(changed),
        navigation,
        window,
        changed
    )

    feedback.Show("old")
    donation.SetInput("owner/repo")
    Regression.Check(donation.Current.Input == "owner/repo" && feedback.Current.Message == "", "typing clears the message")
    Regression.Check(!donation.IsBrowsing, "no issues before searching")

    donation.Current = donation.Current with{
        Models = []ModelChoice{
            ModelChoice{Slug: "a", DisplayName: "A", Efforts: []string{"high", "xhigh"}},
            ModelChoice{Slug: "b", DisplayName: "B", Efforts: []string{"low"}},
        },
    }
    donation.SetModel("a")
    Regression.Equal(donation.Current.Draft.Effort, "high", "a supported effort is kept")
    donation.SetModel("b")
    Regression.Equal(donation.Current.Draft.Effort, "", "an unsupported effort is cleared")
    Regression.Equal(String.Join(",", donation.Current.Efforts()), "low", "efforts follow the model")

    donation.ChooseHarness("pi")
    donation.SetModel("local")
    donation.SetEffort("medium")
    Regression.Check(
        donation.Current.Draft.Model == "local" && donation.Current.Draft.Effort == "medium",
        "local models keep any effort"
    )
    donation.SetEndpoint("http://127.0.0.1:8080/v1")
    Regression.Equal(donation.Current.Draft.Endpoint, "http://127.0.0.1:8080/v1", "endpoint")

    donation.UseProfile(DonorProfile{Name: "fast", Harness: "codex", Provider: "openai", Model: "a", Effort: "xhigh", Endpoint: ""})
    Regression.Check(donation.Current.Draft.Profile == "fast" && donation.Current.Draft.Harness == "codex", "profile applies")
    donation.SetEffort("high")
    Regression.Equal(donation.Current.Draft.Profile, "", "editing leaves the profile")

    donation.SetUnlimited(true)
    donation.ChoosePreset("15")
    Regression.Check(!donation.Current.Draft.Unlimited && donation.Current.Draft.Coding == "15", "a preset ends unlimited")

    donation.Current = donation.Current with{Step = DonationStep.Review}
    donation.ChangeDetails()
    Regression.Check(donation.Current.Step == DonationStep.Limits, "change details returns to limits")
    donation.Back()
    Regression.Check(donation.Current.Step == DonationStep.Issue, "back returns to issues")

    donation.Current = donation.Current with{Policy = Policy.Empty with{MaxSeconds = 60}}
    donation.Review()
    Regression.Equal(feedback.Current.Message, "The time budget exceeds the limit of 1 minutes.", "review checks the budget first")
    Regression.Check(!activity.Busy, "an invalid budget runs no command")
    donation.Current = donation.Current with{
        Policy = Policy.Empty,
        Draft = DonationDraft.Initial with{Harness = "command", Provider = "custom"},
    }
    donation.Reserve()
    Regression.Equal(
        feedback.Current.Message,
        "Tokate did not provide the owner command. Inspect the repository policy before donating.",
        "command donations require owner argv for consent"
    )
    Regression.Check(!activity.Busy, "missing command argv starts no claim")

    donation.Current = donation.Current with{
        Step = DonationStep.Donation,
        Progress = DonationProgress.Empty with{Started = true, Path = "/runs/1"},
    }
    Regression.Check(donation.IsDonating && donation.IsLive, "a started donation is live")
    donation.NewDonation()
    Regression.Check(donation.Current.Step == DonationStep.Issue && !donation.Current.Progress.Started, "new donation")
    Regression.Equal(DonationSteps.Heading(DonationStep.Limits), "Set your limits", "step heading")
    Regression.Check(DonationSteps.Index(DonationStep.Donation) == 3, "step index")
}
