package TokateDesktop

import System
import System.Text.Json

func CodecTests() {
    let pending = CliCodec.Envelope(Regression.Fixture("envelope-pending.json"))
    Regression.Check(pending.Status == CliStatus.Pending && pending.ExitCode == 8, "pending envelope status")
    Regression.Check(CliCodec.Matches(pending, 8, "claim"), "envelope matches the command")
    Regression.Check(!CliCodec.Matches(pending, 0, "claim"), "envelope rejects a different exit code")
    Regression.Check(pending.Error == nil, "null error decodes as none")
    Regression.Equal(pending.NextActions[1].Command, "work", "managed pending claim next action")
    Regression.Equal(String.Join(" ", pending.NextActions[1].Arguments), "tokate work owner/repo#42-1 --json", "exact saved action arguments")
    Regression.Check(pending.NextActions[0].NamesRun, "saved status names an exact attempt")
    let authority = NextAction{Arguments: []string{"tokate", "status", "owner/repo#42"}}
    Regression.Check(!authority.NamesRun, "authority status is not a saved attempt")
    Regression.Equal(CliCodec.RunPath(Regression.Fixture("envelope-pending.json")), "/state/tokate/runs/abc", "run path")
    Regression.Check(RunCodec.Run(Json.Get(Regression.Fixture("envelope-pending.json"), "data")).Guidance.Contains("Do not repost"), "pending claim preserves recovery guidance")

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
    Regression.Equal(run.ErrorMessage, "Independent verification failed. Inspect the private verification artifact.", "run error message")
    Regression.Equal(run.Approval, "appr-1", "run approval")
    Regression.Equal(run.CodingTime, "30 minutes", "coding time text")
    let correction = RunCodec.Run(Json.Parse(
        "{\"correction\":{\"state\":\"verified\",\"commit\":\"corrected\"},\"next\":{\"command\":[\"tokate\",\"amend\",\"--run\",\"/runs/a\",\"--commit\",\"corrected\",\"--time\",\"300s\"]}}"
    ))
    Regression.Equal(correction.Amending, "corrected", "unpublished amendment waits for publication")
    Regression.Check(correction.Finish[1] == "amend", "unpublished amendment finishes with amend")

    let policy = PolicyCodec.FromPolicyResult(Regression.Fixture("policy.json"))
    Regression.Check(policy.Loaded && policy.Version == 3 && policy.MaxSeconds == 5400, "policy basics")
    Regression.Check(policy.AllowsUnlimited, "policy flags")
    Regression.Equal(String.Join(",", policy.RequiredChecks), "build,test", "required checks")
    Regression.Equal(String.Join(" ", policy.Verification[0]), "/bin/sh -c dotnet test", "verification command")
    Regression.Check(
        policy.ModelsFor("codex", "openai").Length == 1 &&
            policy.ModelsFor("codex", "openai")[0].Efforts[1] == "xhigh" &&
            policy.RestrictsTool("codex", "openai") && !policy.RestrictsTool("pi", "local-chat-completions"),
        "per-tool model whitelist and unrestricted tool"
    )
    Regression.Equal(String.Join(",", policy.AllowedTools), "codex,pi", "allowed tools")
    Regression.Check(!PolicyCodec.Policy(JsonElement{}).Loaded, "missing policy is not loaded")
    let legacy = PolicyCodec.Policy(Json.Parse(
        "{\"version\":2,\"model_policy\":\"whitelist\",\"models\":{\"gpt\":[\"high\"]},\"eligibility\":\"manual\",\"allowed_tools\":[{\"harness\":\"codex\",\"provider\":\"openai\"}]}"
    ))
    Regression.Check(legacy.ModelsFor("codex", "openai").Length == 1 && legacy.Eligibility == "trusted", "legacy model and eligibility permissions survive migration")
    let noPolicy = PolicyCodec.FromPolicyResult(Json.Parse("{\"scope\":\"repo\",\"checks\":[{\"check\":\"policy\",\"status\":\"problem\",\"message\":\"No policy\"}]}"))
    Regression.Check(!noPolicy.Loaded && noPolicy.Verification.Length == 0, "successful doctor without a policy means no policy yet")
    let setup = PolicyCodec.Setup(Json.Parse(
        "{\"applied\":false,\"changes\":[{\"change\":\"Setup PR\",\"old\":\"\",\"new\":\"Set up Tokate\"}],\"manual\":[\"Review branch protection\"],\"pull_request\":\"https://github.com/o/r/pull/2\"}"
    ))
    Regression.Check(!setup.Applied && setup.Manual.Length == 1 && setup.PullRequest.EndsWith("/2"), "setup preview and PR fields")
    let combined = PullRequestCodec.Review(Json.Parse("{\"gates\":{\"receipt\":{\"status\":\"passed\"}},\"checks_status\":\"pending\"}"))
    Regression.Check(combined.Receipt == "verified" && combined.Ci == "pending", "receipt can pass while CI is pending")
    let commandPolicy = PolicyCodec.Policy(Json.Parse(
        "{\"version\":3,\"allowed_tools\":[{\"harness\":\"command\",\"provider\":\"custom\",\"command\":[\"tool\",\"{model}\",\"{prompt_file}\"],\"output\":\"session\",\"models\":{\"custom-model\":[\"high\"]}}]}"
    ))
    let commandDraft = SetupDraft.From(commandPolicy)
    Regression.Check(commandDraft.ToolModels[0].Command[2] == "{prompt_file}" && commandDraft.ToolModels[0].Output == "session", "command declarations survive policy decoding and setup")

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
    Regression.Equal(
        PullRequestCodec.ChecksStatus(Json.Parse("{\"machine_status\":\"historical\",\"checks_status\":\"unread\"}")),
        "historical",
        "closed pull requests retain historical machine state"
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
    let scoped = PolicyCodec.Policy(Json.Parse(
        "{\"version\":3,\"allowed_tools\":[{\"harness\":\"pi\",\"provider\":\"local-chat-completions\",\"models\":{\"claude-opus-5-5\":[\"high\"]}},{\"harness\":\"omp\",\"provider\":\"openrouter\",\"models\":{\"a/b\":[\"max\"]}},{\"harness\":\"omp\",\"provider\":\"anthropic\"}]}"
    ))
    Regression.Check(ModelChoice.Catalog("pi", "", []ModelChoice{}, omp, scoped)[0].Slug == "claude-opus-5-5", "Pi uses its own model permissions")
    Regression.Check(ModelChoice.Catalog("omp", "openrouter", []ModelChoice{}, omp, scoped)[0].Efforts.Length == 0, "OMP efforts are scoped to its provider")
    Regression.Check(ModelChoice.Catalog("omp", "anthropic", []ModelChoice{}, omp, scoped).Length == 1, "a tool without models is unrestricted")
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
    Regression.Check(work[0].NeedsApproval && work[0].NextAction.Contains("tokate approve"), "stale label approvals retain owner guidance")

    Regression.Throws(() -> Json.Parse(String('x', Json.MaxLength + 1)), "JSON input exceeds the size limit.", "size limit")
}
