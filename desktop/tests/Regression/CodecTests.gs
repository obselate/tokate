package TokateDesktop

import System
import System.Text.Json

func CodecTests() {
    let pending = CliCodec.Envelope(Regression.Fixture("envelope-pending.json"))
    Regression.Check(pending.Status == CliStatus.Pending && pending.ExitCode == 8, "pending envelope status")
    Regression.Check(CliCodec.Matches(pending, 8, "claim"), "envelope matches the command")
    Regression.Check(!CliCodec.Matches(pending, 0, "claim"), "envelope rejects a different exit code")
    Regression.Check(pending.Error == nil, "null error decodes as none")
    Regression.Equal(pending.NextActions[1].Command, "prepare", "next action command")
    Regression.Equal(CliCodec.RunPath(Regression.Fixture("envelope-pending.json")), "/state/tokate/runs/abc", "run path")

    let failed = Regression.Fixture("envelope-error.json")
    let envelope = CliCodec.Envelope(failed)
    Regression.Equal(envelope.Error?.Code ?? "", "stale_approval", "error code")
    Regression.Equal(envelope.Error?.Message ?? "", "The approval is stale.", "error message")
    Regression.Check(envelope.Truncated, "truncated flag")
    Regression.Check(
        CliCodec.Report(failed).EndsWith("\nSome results were omitted by the CLI.") &&
            CliCodec.Report(failed).Contains("stale_approval"),
        "report prefers the error and notes truncation"
    )

    let run = RunCodec.Run(Regression.Fixture("run-status.json"))
    Regression.Equal(run.Path, "/state/tokate/runs/abc", "run path from data")
    Regression.Equal(run.Harness, "pi", "first tool harness wins")
    Regression.Check(run.Issue == 42 && run.Pr == 7 && run.CodingSeconds == 1800, "run numbers")
    Regression.Check(!run.Unlimited, "run flags")
    Regression.Equal(run.ErrorMessage, "Verification failed.", "run error message")
    Regression.Equal(run.Approval, "appr-1", "run approval")
    Regression.Equal(run.CodingTime, "30 minutes", "coding time text")

    let policy = PolicyCodec.FromPolicyResult(Regression.Fixture("policy.json"))
    Regression.Check(policy.Loaded && policy.Version == 2 && policy.MaxSeconds == 5400, "policy basics")
    Regression.Check(policy.AllowsUnlimited, "policy flags")
    Regression.Equal(String.Join(",", policy.RequiredChecks), "build,test", "required checks")
    Regression.Equal(String.Join(" ", policy.Verification[0]), "/bin/sh -c dotnet test", "verification command")
    Regression.Check(
        policy.Models.Length == 2 && policy.Models[0].Model == "gpt-6.1-sol" && policy.Models[0].Efforts[1] == "xhigh",
        "model whitelist"
    )
    Regression.Equal(String.Join(",", policy.AllowedTools), "codex,pi", "allowed tools")
    Regression.Check(!PolicyCodec.Policy(JsonElement{}).Loaded, "missing policy is not loaded")

    let search = IssueCodec.Search(Regression.Fixture("search.json"))
    Regression.Check(search.Total == 1203 && search.Rows.Length == 2, "search totals")
    Regression.Check(search.Rows[0].IsApproved && !search.Rows[0].IsPullRequest, "approved issue")
    Regression.Check(search.Rows[1].IsPullRequest, "pull request flag")

    Regression.Equal(
        PullRequestCodec.ChecksStatus(Json.Parse("{\"checks_status\":\"pending\",\"workflow_runs_awaiting_approval\":[{\"id\":7}]}")),
        DraftReview.NeedsApproval,
        "workflow runs that wait for the owner come before the checks state"
    )
    Regression.Equal(
        PullRequestCodec.ChecksStatus(Json.Parse("{\"checks_status\":\"pending\",\"workflow_runs_awaiting_approval\":[]}")),
        "pending",
        "checks without waiting workflow runs keep their state"
    )
    let pull = PullRequestCodec.PullRequest(Regression.Fixture("pull-request.json"))
    Regression.Check(pull.ChecksPending && !pull.ChecksFailed, "pull request checks")

    let access = AccessCodec.Access(Regression.Fixture("access.json"))
    Regression.Equal(access.AccessSha, "abc123", "access sha")
    Regression.Equal(access.Pending[0].Issue, "42", "numeric issue text")
    Regression.Equal(access.Members[0].Badge, "Trusted", "trusted badge")
    Regression.Equal(access.Members[1].Badge, "Denied", "denied badge")

    let profiles = DonorCodec.Profiles(Regression.Fixture("profiles.json"))
    Regression.Check(profiles.Length == 2 && profiles[1].Name == "local", "profiles")
    Regression.Equal(profiles[1].Endpoint, "http://127.0.0.1:8080/v1", "profile endpoint")
    Regression.Check(DonorCodec.Profiles(JsonElement{}).Length == 0, "missing profiles")
    let chosen = DonorCodec.Profiles(
        Json.Parse(
            "{\"default\":{\"harness\":\"omp\",\"provider\":\"openrouter\",\"model\":\"a/b\",\"effort\":\"low\"},\"profiles\":{\"fast\":{\"harness\":\"omp\",\"provider\":\"openrouter\",\"model\":\"a/b\",\"effort\":\"low\"},\"slow\":{\"harness\":\"omp\",\"provider\":\"openrouter\",\"model\":\"a/b\",\"effort\":\"high\"}}}"
        )
    )
    Regression.Check(chosen[0].Default && !chosen[1].Default, "the profile that matches the default")

    let models = DonorCodec.CodexModels(Regression.Fixture("codex-models.json"))
    Regression.Check(models.Length == 2 && models[1].Hidden && models[0].Efforts.Length == 3, "codex models")

    let omp = DonorCodec.OmpModels(
        Json.Parse(
            "{\"models\":[{\"provider\":\"openrouter\",\"id\":\"a/b\",\"kind\":\"chat\",\"reasoning\":true,\"thinking\":[\"low\",\"high\"]},{\"provider\":\"anthropic\",\"id\":\"plain\",\"kind\":\"chat\",\"reasoning\":false},{\"provider\":\"openrouter\",\"id\":\"image\",\"kind\":\"image\"}]}"
        )
    )
    Regression.Equal(String.Join(",", omp[0].Efforts) + " " + omp[1].Efforts[0], "off,low,high absent", "omp efforts")
    Regression.Check(omp.Length == 2 && omp[0].Provider == "openrouter", "omp chat models")
    let whitelist = Policy.Empty with{
        Loaded = true,
        Models = []ModelAllowance{
            ModelAllowance{Model: "a/b", Efforts: []string{"high", "max"}},
            ModelAllowance{Model: "claude-opus-5-5", Efforts: []string{"high"}},
        },
    }
    let offered = ModelChoice.Catalog("omp", "openrouter", []ModelChoice{}, omp, whitelist)
    Regression.Check(offered.Length == 1 && String.Join(",", offered[0].Efforts) == "high", "whitelist limits the catalog")
    Regression.Check(ModelChoice.Catalog("omp", "anthropic", []ModelChoice{}, omp, Policy.Empty).Length == 1, "catalog of a provider")
    let local = ModelChoice.Catalog("pi", "", []ModelChoice{}, omp, whitelist)
    Regression.Check(local.Length == 1 && local[0].Slug == "a/b", "whitelist offers Pi the models of no other catalog")
    let claude = DonationState.Initial with{Policy = whitelist, Draft = DonationDraft.Initial.ForHarness("claude")}
    Regression.Equal(
        (claude with{Draft = claude.Draft with{Model = "claude-opus-5-5", Effort = "max"}}).Settled().Draft.Model +
            "/" +
            (claude with{Draft = claude.Draft with{Model = "claude-opus-5-5", Effort = "max"}}).Settled().Draft.Effort,
        "claude-opus-5-5/",
        "an effort outside the whitelist is cleared"
    )
    Regression.Equal(
        (claude with{Draft = claude.Draft with{Model = "claude-fable-5-1", Effort = "high"}}).Settled().Draft.Model,
        "",
        "a model outside the whitelist is cleared"
    )
    Regression.Check(
        !DonorCodec.HarnessReady(Json.Parse("{\"tools\":[{\"name\":\"pi\",\"status\":\"failed\"}]}"), "pi") &&
            DonorCodec.HarnessReady(Json.Parse("{\"tools\":[]}"), "pi"),
        "harness readiness"
    )

    let reservation = RunCodec.Reservation(Regression.Fixture("coordination.json"))
    let claim = RunCodec.ClaimId(Regression.Fixture("run-file.json"))
    let owner = Run.Empty with{Approval = "appr-1", DonorId = "12345"}
    Regression.Check(reservation.IsReadyFor(owner, claim, 1000), "decoded reservation is ready")
    Regression.Throws(
        () -> RunCodec.ClaimId(JsonElement{}),
        "Saved claim identity is missing.",
        "claim identity is required"
    )

    let work = IssueCodec.Work(Regression.Fixture("issue-work.json"))
    Regression.Check(work.Length == 1 && work[0].Issue == "42" && work[0].Drafts[1] == "9", "issue work")

    Regression.Throws(() -> Json.Parse(String('x', Json.MaxLength + 1)), "JSON input exceeds the size limit.", "size limit")
}
