package TokateDesktop

import System
import System.Text.Json

func CodecTests() {
    let pending = CliCodec.Envelope(Regression.Fixture("envelope-pending.json"))
    Regression.Check(pending.Status == CliStatus.Ok && pending.ExitCode == 0, "pending run status read succeeds")
    Regression.Check(CliCodec.Matches(pending, 0, "status"), "envelope matches the command")
    Regression.Check(!CliCodec.Matches(pending, 8, "status"), "envelope rejects a different exit code")
    Regression.Check(pending.Error == nil, "null error decodes as none")
    Regression.Equal(pending.NextActions[0].Command, "status", "pending run next action")
    Regression.Equal(String.Join(" ", pending.NextActions[0].Arguments), "tokate status --run /home/xaz/.local/state/tokate/runs/foxholt-tokate-demo-5-1 --json", "exact saved action arguments")
    Regression.Check(pending.NextActions[0].NamesRun, "saved status names an exact attempt")
    let authority = NextAction{Arguments: []string{"tokate", "status", "owner/repo#42"}}
    Regression.Check(!authority.NamesRun, "authority status is not a saved attempt")
    Regression.Equal(CliCodec.RunPath(Regression.Fixture("envelope-pending.json")), "/home/xaz/.local/state/tokate/runs/foxholt-tokate-demo-5-1", "run path")
    Regression.Check(RunCodec.Run(Json.Get(Regression.Fixture("envelope-pending.json"), "data")).Guidance.Contains("owner reruns"), "pending claim preserves recovery guidance")
    let published = CliCodec.Envelope(Regression.Fixture("run-published.json"))
    Regression.Check(published.NextActions.Length == 1 && published.NextActions[0].NamesRun, "finished run retains only exact saved status")
    Regression.Check(RunActions.From(published.NextActions, "published").Length == 0, "finished run offers no work or checks actions")

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

    let run = RunCodec.Run(Json.Get(Regression.Fixture("run-status.json"), "data"))
    Regression.Equal(run.Path, "/home/xaz/.local/state/tokate/runs/obselate-tokate-616-1", "run path from data")
    Regression.Equal(run.Harness, "codex", "first tool harness wins")
    Regression.Check(run.Issue == 616 && run.Pr == 0 && run.CodingSeconds == 7200, "run numbers")
    Regression.Check(!run.Unlimited, "run flags")
    Regression.Equal(run.ErrorMessage, "Command failed. Inspect relevant state and private artifacts before any explicit next action.", "run error message")
    Regression.Equal(run.Approval, "7072e65e5d839daaf191385e517d284469efd33dda16487f58ca2a36464e78e1", "run approval")
    Regression.Equal(run.CodingTime, "120 minutes", "coding time text")
    let correction = RunCodec.Run(Json.Parse(
        "{\"correction\":{\"state\":\"verified\",\"commit\":\"corrected\"},\"next\":{\"command\":[\"tokate\",\"amend\",\"--run\",\"/runs/a\",\"--commit\",\"corrected\",\"--time\",\"300s\"]}}"
    ))
    Regression.Equal(correction.Amending, "corrected", "unpublished amendment waits for publication")
    Regression.Check(correction.Finish[1] == "amend", "unpublished amendment finishes with amend")

    let policyData = Json.Get(Regression.Fixture("policy.json"), "data")
    let policy = PolicyCodec.FromPolicyResult(policyData)
    Regression.Check(policy.Loaded && policy.Version == 3 && policy.Verification.Length == 1, "released doctor decodes version 3 policy")
    Regression.Check(Json.Text(policyData, "scope") == "repo" && PolicyCodec.OwnerHealth(policyData).Contains("policy: ok"), "released repository diagnostics retain healthy policy")
    let stable = Json.Parse("{\"checks\":[{\"check\":\"coordinator\",\"status\":\"ok\",\"pin\":\"v0\",\"matches_cli\":true,\"version\":\"\",\"cli_version\":\"0.7.0\",\"message\":\"Coordinator follows stable-major releases at v0.\"},{\"check\":\"access\",\"status\":\"ok\",\"present\":false,\"member_count\":0,\"trusted_count\":0,\"message\":\"Empty access record. Members 0, trusted 0.\"}]}")
    let stableReport = PolicyCodec.OwnerHealth(stable)
    Regression.Check(stableReport.Contains("stable-major releases at v0") && !stableReport.Contains("CLI") && stableReport.Contains("Empty access record"), "stable workflow and missing access ref need no repair")
    let failedCoordinator = Json.Parse("{\"checks\":[{\"check\":\"last_run\",\"status\":\"problem\",\"conclusion\":\"failure\",\"html_url\":\"https://github.com/o/r/actions/runs/7\"}]}")
    Regression.Equal(PolicyCodec.FailedCoordinatorRun(failedCoordinator, "o/r"), "https://github.com/o/r/actions/runs/7", "failed coordinator links its exact run")
    Regression.Equal(PolicyCodec.FailedCoordinatorRun(Json.Parse("{\"checks\":[{\"check\":\"last_run\",\"conclusion\":\"failure\"}]}"), "o/r"), "https://github.com/o/r/actions", "failed coordinator falls back to repository Actions")
    Regression.Equal(PolicyCodec.FailedCoordinatorRun(stable, "o/r"), "", "healthy checks do not offer a rerun")
    let external = Json.Get(Regression.Fixture("doctor-external.json"), "data")
    Regression.Check(PolicyCodec.OwnerHealth(external).Contains("curl: ready") && PolicyCodec.OwnerHealth(external).Contains("tar: ready"), "real owner prerequisites include curl and tar")
    Regression.Check(!PolicyCodec.Policy(JsonElement{}).Loaded, "missing policy is not loaded")
    let noPolicy = PolicyCodec.FromPolicyResult(Json.Parse("{\"scope\":\"repo\",\"checks\":[{\"check\":\"policy\",\"status\":\"problem\",\"message\":\"No policy\"}]}"))
    Regression.Check(!noPolicy.Loaded && noPolicy.Verification.Length == 0, "successful doctor without a policy means no policy yet")
    let setup = PolicyCodec.Setup(Json.Parse(
        "{\"applied\":false,\"changes\":[{\"change\":\"Setup PR\",\"old\":\"\",\"new\":\"Set up Tokate\"}],\"manual\":[\"Review and merge the setup PR\"],\"pull_request\":\"https://github.com/o/r/pull/2\"}"
    ))
    Regression.Check(!setup.Applied && setup.Manual.Length == 1 && setup.PullRequest.EndsWith("/2"), "setup preview and PR fields")
    Regression.Check(setup.Changes[0].Setting == "Setup PR" && setup.Changes[0].Current == "" && setup.Changes[0].Proposed == "Set up Tokate", "setup changes decode source change old new fields")
    let releasedSetup = PolicyCodec.Setup(Json.Get(Regression.Fixture("init.json"), "data"))
    Regression.Check(!releasedSetup.Applied && releasedSetup.Changes.Length > 0 && releasedSetup.Changes[0].Setting == ".github/tokate.json" && releasedSetup.Changes[0].Current.Contains("3600") && releasedSetup.Changes[0].Proposed.Contains("2700"), "released init preview decodes change old new")
    let draft = PullRequestCodec.Review(Json.Get(Regression.Fixture("checks-draft.json"), "data"))
    Regression.Check(draft.Receipt == "verified" && draft.Ci == DraftReview.NeedsApproval, "released draft retains verified receipt and workflow approval")
    let combined = PullRequestCodec.Review(Json.Parse("{\"gates\":{\"receipt\":{\"status\":\"passed\"}},\"checks_status\":\"pending\"}"))
    Regression.Check(combined.Receipt == "verified" && combined.Ci == "pending", "receipt can pass while CI is pending")
    let conflict = PullRequestCodec.Review(Json.Parse("{\"gates\":{\"receipt\":{\"status\":\"passed\"}},\"checks_status\":\"passed\",\"mergeable\":false,\"target_merge_required\":true}"))
    Regression.Check(conflict.NeedsAmendment, "conflicting target merges need donor amendment")
    let clean = PullRequestCodec.Review(Json.Parse("{\"gates\":{\"receipt\":{\"status\":\"passed\"}},\"checks_status\":\"passed\",\"mergeable\":true,\"target_moved\":true}"))
    Regression.Check(!clean.NeedsAmendment && clean.Receipt == "verified", "clean target merges retain verified receipt")
    let settling = PullRequestCodec.Review(Json.Parse("{\"gates\":{\"receipt\":{\"status\":\"pending\",\"reason\":\"pr_head_unavailable\"}},\"checks_status\":\"unread\",\"machine_status\":\"pending\"}"))
    Regression.Check(settling.Receipt == "pending" && settling.ReceiptTone == Tone.Wait, "an unavailable pushed head waits instead of failing")
    let optional = PolicyCodec.Policy(Json.Parse("{\"version\":3,\"eligibility\":\"trusted\"}"))
    Regression.Check(optional.Verification.Length == 0 && optional.RequiredChecks.Length == 0, "optional policy fields use 0.7.0 defaults")
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
    let pull = PullRequestCodec.PullRequest(Regression.Fixture("pull-request.json"))
    Regression.Check(pull.ChecksPending && !pull.ChecksFailed, "pull request checks")

    let access = AccessCodec.Access(Regression.Fixture("access.json"))
    Regression.Equal(access.AccessSha, "abc123", "access sha")
    Regression.Equal(access.Pending[0].Issue, "42", "numeric issue text")
    Regression.Equal(access.Members[0].Badge, "Trusted", "trusted badge")
    Regression.Equal(access.Members[1].Badge, "Denied", "denied badge")
    let denied = AccessCodec.Access(Json.Parse("{\"access_sha\":\"\",\"pending\":[{\"donor\":\"Eve\",\"issue\":42}],\"members\":[{\"donor\":\"eve\",\"trusted\":true,\"denied\":true}]}"))
    Regression.Check(denied.Pending.Length == 0 && denied.Members[0].Badge == "Denied", "deny wins over trust and requests")
    let emptyAccess = AccessCodec.Access(Json.Parse("{\"access_sha\":\"\",\"members\":[],\"pending\":[]}"))
    Regression.Check(emptyAccess.Loaded && emptyAccess.Members.Length == 0, "missing access ref is a loaded empty record")

    let profiles = DonorCodec.Profiles(Json.Get(Regression.Fixture("profiles.json"), "data"))
    Regression.Check(profiles.Length == 2 && profiles[0].Name == "local", "profiles")
    Regression.Check(profiles[0].Harness == "pi" && profiles[1].Provider == "openrouter" && profiles[1].Model == "~deepseek/deepseek-flash-latest", "real profile selection fields")
    Regression.Check(DonorCodec.Profiles(JsonElement{}).Length == 0, "missing profiles")
    let selection = DonorCodec.Selection(Json.Get(Regression.Fixture("selection.json"), "data"))
    Regression.Check(selection.Harness == "codex" && selection.Provider == "openai" && selection.Model == "gpt-6.1-sol" && selection.Effort == "high", "released explicit selection decodes")
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
    Regression.Check(DonorCodec.HarnessReady(Json.Get(Regression.Fixture("doctor-managed.json"), "data"), "codex"), "installed managed harness is ready")

    let coordination = Json.Get(Regression.Fixture("coordination.json"), "data")
    let reservation = RunCodec.Reservation(coordination)
    Regression.Check(reservation.ApprovalId == "cfa56c8840aba181821afe9c2404df8e4a499ecf30878ba779942852aa25cd38" && reservation.Revoked == false, "released issue coordination retains approval")
    Regression.Check(reservation.Actor == "11948473" && reservation.Lease == "47ddb527-e6e9-4275-881d-876044c9b19e" && reservation.Attempt == reservation.Lease && reservation.Status == "active" && reservation.Expires > 0, "released active reservation retains attempt")
    Regression.Equal(RunCodec.ContributionHead(coordination), "", "accepted claim has no contribution head")
    Regression.Check(RunCodec.ClaimId(Regression.Fixture("run-file.json")) != "", "saved claim identity decodes")
    Regression.Throws(
        () -> RunCodec.ClaimId(JsonElement{}),
        "Saved claim identity is missing.",
        "claim identity is required"
    )

    let work = IssueCodec.Work(Json.Get(Regression.Fixture("issue-work.json"), "data"))
    Regression.Check(work.Length == 1 && work[0].Issue == "642" && work[0].Drafts[0] == "654", "real owner work retains issue and draft PR")
    let closedData = Json.Get(Regression.Fixture("issue-closed.json"), "data")
    let closedWork = IssueCodec.Work(closedData)
    Regression.Check(closedWork.Length == 1 && closedWork[0].Issue == "646" && closedWork[0].State == "closed", "real closed issue status keeps its work row")
    let closedCoordination = Json.Get(closedData, "coordination")
    Regression.Check(Json.Int(closedCoordination, "issue") == 646 && Json.Text(Json.Get(closedCoordination, "contribution"), "head") != "", "closed issue retains coordination and contribution head")

    Regression.Throws(() -> Json.Parse(String('x', Json.MaxLength + 1)), "JSON input exceeds the size limit.", "size limit")
}
