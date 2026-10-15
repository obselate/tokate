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
    donation.SetCoding("15")
    Regression.Check(!donation.Current.Draft.Unlimited && donation.Current.Draft.BudgetSeconds(Policy.Empty) == 900, "a preset sets total time and ends unlimited")

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
    let preview = CliCodec.Envelope(Regression.Fixture("donation-gratis-preview.json"))
    Regression.Check(preview.Error?.Code == "confirmation_required" && preview.ExitCode == 1, "real gratis preview requires consent")
    let ownerPreview = CliCodec.Envelope(Regression.Fixture("donation-owner-preview.json"))
    Regression.Check(ownerPreview.Error?.Code == "confirmation_required" && ownerPreview.ExitCode == 1, "released owner policy preview requires consent")
    let stop = CliCodec.Envelope(Regression.Fixture("donation-stop-preview.json"))
    Regression.Check(stop.Error?.Code == "confirmation_required" && stop.ExitCode == 1, "real stop preview requires consent")
    Regression.Equal(
        Regression.Args(TokateCommands.RepositoryWork("owner/repo", DonationDraft.Initial, "15", "30", "https://example.org/task")),
        "work owner/repo --harness codex --model gpt-6.1-sol --effort high --non-interactive --time 15m --total 30m --prompt https://example.org/task",
        "repository preview carries selection, limits and prompt without consent"
    )
    Regression.Equal(
        Regression.Args(TokateCommands.RepositoryWork("owner/repo", DonationDraft.Initial with{Profile = "saved"}, "60", "", "")),
        "work owner/repo --harness codex --model gpt-6.1-sol --effort high --non-interactive --time 60m",
        "repository profile without total runs until stopped"
    )
    Regression.Equal(Regression.Args(TokateCommands.RepositoryStop("owner/repo")), "work owner/repo stop --yes", "repository stop waits through CLI")
    Regression.Equal(
        Regression.Args(TokateCommands.RepositoryWork("owner/repo", DonationDraft.Initial, "180", "", "", "12,15,40", true)),
        "work owner/repo#12,15,40 --harness codex --model gpt-6.1-sol --effort high --non-interactive --time 180m --review",
        "gratis issue list and review carry no artificial hour cap"
    )
    donation.Current = DonationState.Initial with{RepositoryMode = true, Repository = "owner/repo", Consent = "exact", ReviewedArguments = []string{"work"}, Policy = Policy.Empty with{MaxSeconds = 3600}}
    donation.SetPerTask("120")
    Regression.Equal(donation.Current.PerTask, "60", "policy rejects controls above its limit")
    donation.SetPerTask("30")
    Regression.Check(donation.Current.Consent == "" && donation.Current.ReviewedArguments.Length == 0, "a time change invalidates preview consent")
    donation.Current = donation.Current with{Consent = "exact", ReviewedArguments = []string{"work"}}
    donation.SetReviewEach(true)
    Regression.Check(donation.Current.Consent == "" && donation.Current.ReviewedArguments.Length == 0, "a review change invalidates preview consent")
    Regression.Equal(DonorCodec.Usage(Json.Parse("{\"input_tokens\":12345,\"cached_input_tokens\":2000,\"output_tokens\":321}")), "12.3K input · 2.0K cached · 321 output tokens", "usage is readable")
    Regression.Equal(DonorCodec.WallTime("3725.5"), "1 h 2 min", "wall time is readable")
}
