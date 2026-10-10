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
    Regression.Check(run.Network && !run.Unlimited, "run flags")
    Regression.Equal(run.ErrorMessage, "Verification failed.", "run error message")
    Regression.Equal(run.Approval, "appr-1", "run approval")
    Regression.Equal(run.CodingTime, "30 minutes", "coding time text")

    let policy = PolicyCodec.FromPolicyResult(Regression.Fixture("policy.json"))
    Regression.Check(policy.Loaded && policy.Version == 2 && policy.MaxSeconds == 5400, "policy basics")
    Regression.Check(policy.AllowsUnlimited && !policy.AllowNetwork, "policy flags")
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

    let models = DonorCodec.CodexModels(Regression.Fixture("codex-models.json"))
    Regression.Check(models.Length == 2 && models[1].Hidden && models[0].Efforts.Length == 3, "codex models")

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
