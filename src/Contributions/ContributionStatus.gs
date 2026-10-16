package Tokate

import System
import System.Collections.Generic
import System.Text.Json

internal class ContributionStatus {
    internal var Failure CliFailure? = nil
    internal var Truncated bool
    private var Viewer JsonElement
    private var Info JsonElement
    private var Access AccessState? = nil
    private var Repo string = ""
    private var GratisRepo bool
    internal let Result Dictionary[string, Object?] = map[string, Object?]{}
    private let Work List[Object] = List[Object]()
    private let Requests List[JsonElement] = List[JsonElement]()
    private let Saved SavedRuns = SavedRuns(RunStorage.Roots())

    private suspend func Observe(target Dictionary[string, Object?], part string, read async () -> void) bool {
        try {
            await read()
            return true
        } catch (error Exception) when Expected(error) || error is ApiDeadlineException {
            return Unavailable(target, part, error)
        }
    }

    private func Expected(error Exception) bool -> error is CliFailure ||
        error is JsonException ||
        error.GetType() == typeof(Exception)

    private func Unavailable(target Dictionary[string, Object?], part string, error Exception) bool {
        target[part + "_status"] = "unavailable"
        target[
            part + "_reason"
        ] = error is CliFailure failure ? failure.Summary: "Required remote data is unavailable or malformed."
        Failure = Failure ?? Failed(error)

        return false
    }

    private func Failed(error Exception) CliFailure -> error as CliFailure ??
        CliFailure("command_failed", error.Message, summary: PublicOutput.Message("command_failed"))

    private func Next(role string, action string, command[]string = nil) Dictionary[string, Object?] -> map[
        string,
        Object?
    ]{"role": role, "action": action, "command": command ?? []string{}}

    private func View(number string)[]string -> []string{"gh", "pr", "view", number, "--repo", Repo}

    private func Stale(row Dictionary[string, Object?], error CliFailure) {
        row["approval_status"] = "stale"
        row["approval_reason"] = error.Summary
    }

    private func Issue(task JsonElement) Dictionary[string, Object?] {
        let issue = J.Number(task, "number")

        if issue < 1 {
            throw CliFailure("invalid_state", "Expected an issue number")
        }

        if J.Get(task, "pull_request").ValueKind != JsonValueKind.Undefined {
            throw CliFailure("invalid_state", "Choose an issue, not a pull request")
        }

        let row = map[string, Object?]{
            "issue": issue,
            "title": PublicOutput.Prose(J.Text(task, "title"), ref Truncated),
            "url": "https://github.com/" + Repo + "/issues/" + issue.ToString(),
            "approval_status": "unknown",
            "eligibility_status": "unknown",
            "coordination_status": "unknown",
            "drafts_status": "unknown",
            "state": "unknown",
            "next": Next("owner", "Inspect unavailable contribution state.")
        }
        Work.Add(row)

        let runs = Saved.For(Repo, issue)
        let run = runs.Count == 0 ? nil: runs[runs.Count - 1]
        if GratisRepo || (run != nil && J.Bool(run.Value, "gratis")) {
            row["approval_status"] = "not_required"
            row["eligibility_status"] = "not_required"
            row["coordination_status"] = "not_required"
            row["drafts_status"] = "not_observed"
            row["state"] = run != nil && J.Bool(run.Value, "gratis") ? run.State: J.Text(task, "state")
            row["next"] = run == nil ?
            Next(
                "donor",
                "Start gratis work on this issue.",
                []string{"tokate", "work", Repo + "#" + issue.ToString()}
            ):
            Next("donor", "Inspect your saved gratis work.", []string{"tokate", "status", "--run", run.Location})
            return row
        }

        var state = CoordinationState()
        var approval JsonElement
        var policy JsonElement

        let loaded = Observe(
            row,
            "coordination",
            async () -> {
                state = CoordinationState.Load(Repo, issue, missing: true)
                row["coordination_status"] = state.Sha == "" ? "absent": "observed"
                row["state_sha"] = state.Sha
                if state.Sha != "" {
                    let value = state.Value()
                    approval = J.Get(value, "approval")
                    row["approval_id"] = J.Text(value, "approval_id")
                    row["revoked"] = J.Bool(value, "revoked")
                    Reservation(row, state)
                }
            }
        )

        if !loaded {
            row["state"] = "unavailable"
            return row
        }

        if J.Text(task, "state") != "open" {
            let drafts = List[Object]()
            row["state"] = "closed"
            row["drafts"] = drafts
            row["next"] = Next("owner", "The issue is closed. Reopen it to accept more work.")
            if approval.ValueKind != JsonValueKind.Undefined {
                Observe(row, "drafts", async () -> Drafts(issue, row, state, approval, policy, drafts))
            }
            for item in drafts {
                if Text(item as Dictionary[string, Object?] ?? throw Exception("Invalid status draft"), "lifecycle") ==
                "merged" {
                    row["next"] = nil
                }
            }
            return row
        }

        if approval.ValueKind == JsonValueKind.Undefined {
            row["approval_status"] = "absent"
            row["drafts_status"] = "absent"
            row["state"] = "approval_waiting"
            row["next"] = Next(
                "owner",
                "Approve the issue under the current policy and target branch.",
                []string{"tokate", "approve", Repo + "#" + issue.ToString()}
            )
            return row
        }

        row["approval"] = J.Select(
            approval,
            "version,approval_scope,eligibility,donor,base,base_branch,authority_branch"
        )

        let valid = Observe(
            row,
            "approval",
            async () -> {
                try {
                    if !RepositoryIdentity.SameRepo(J.Text(approval, "repo"), Repo) || J.Number(
                        approval,
                        "issue"
                    ) != issue ||
                        J.Number(approval, "version") != 2 {
                        throw CliFailure("invalid_state", "Malformed approval identity")
                    }

                    policy = J.Get(state.CheckApproval(Repo, issue, quiet: true), "policy")
                    row["approval_status"] = "current"
                } catch (error CliFailure) when error.Code == "stale_approval" {
                    Stale(row, error)
                }
            }
        )

        if Viewer.ValueKind == JsonValueKind.Undefined {
            row["eligibility_status"] = "unavailable"
        } else if valid && Text(row, "approval_status") == "current" {
            try {
                AccessState.Task(approval)

                if RepositoryIdentity.PositiveId(J.Get(approval, "repo_id")) != RepositoryIdentity.PositiveId(
                    J.Get(Info, "id")
                ) {
                    throw CliFailure("stale_approval", "Task repository numeric identity changed")
                }

                if Access == nil {
                    throw CliFailure("invalid_state", "Task-scoped donor access is unavailable")
                }

                let actor = RepositoryIdentity.PositiveId(J.Get(Viewer, "id"))
                let mode = AccessState.Mode(policy)
                let eligible = Access?.Allows(actor, mode, approval) == true
                row["eligibility_status"] = eligible ? "eligible": "access_waiting"
                row["eligibility_scope"] = "viewer"
                row["eligibility"] = map[string, Object?]{
                    "donor": RepositoryIdentity.Login(J.Text(Viewer, "login")),
                    "actor": actor,
                    "mode": mode,
                    "eligible": eligible
                }

                for member in Access?.Members ?? List[JsonElement]() {
                    if RepositoryIdentity.PositiveId(J.Get(member, "actor")) == actor {
                        row["viewer_denied"] = J.Bool(member, "denied")
                    }
                }

                let reservation = J.Get(state.Value(), "reservation")
                if reservation.ValueKind == JsonValueKind.Object {
                    let holder = RepositoryIdentity.PositiveId(J.Get(reservation, "actor"))
                    row["holder_eligible"] = Access?.Allows(holder, mode, approval) == true
                }
            } catch (error Exception) when Expected(error) {
                Unavailable(row, "eligibility", error)
            }
        }

        let drafts = List[Object]()
        row["drafts"] = drafts

        Observe(row, "drafts", async () -> Drafts(issue, row, state, approval, policy, drafts))

        Observe(
            row,
            "remote",
            async () -> {
                let latest = GitHub.Api(
                    "repos/" + Repo + "/git/ref/heads/" + CoordinationState.Ref(issue),
                    missing: true
                )

                if J.Text(J.Get(latest, "object"), "sha") != state.Sha {
                    row["remote_status"] = "stale"
                } else if Text(row, "approval_status") == "current" {
                    try {
                        state.CheckApproval(Repo, issue, quiet: true)
                        row["remote_status"] = "observed"
                    } catch (error CliFailure) when error.Code == "stale_approval" {
                        Stale(row, error)
                    }
                }
            }
        )

        ActionFor(row, drafts, state, policy)

        return row
    }

    private func Drafts(
        issue int32,
        row Dictionary[string, Object?],
        state CoordinationState,
        approval JsonElement,
        policy JsonElement,
        drafts List[Object]
    ) {
        let value = state.Value()
        let handoff = J.Get(J.Get(J.Get(value, "contribution"), "metadata"), "handoff")

        if handoff.ValueKind == JsonValueKind.Object {
            row["handoff"] = handoff
        }

        let numbers = List[int32]{J.Number(J.Get(CoordinationState.Current(value), "outcome"), "pr")}
        let reservation = J.Get(value, "reservation")
        let donor = J.Text(reservation, "donor")

        if numbers[0] == 0 && donor != "" {
            let branch = "tokate/v2-" + J.Text(reservation, "reservation")
            RepositoryIdentity.Login(donor)
            RepositoryIdentity.Branch(branch)

            let pulls = GitHub.Api(
                "repos/" + Repo + "/pulls?state=all&head=" + Uri.EscapeDataString(donor + ":" + branch) +
                    "&base=" +
                    Uri.EscapeDataString(J.Text(approval, "base_branch")) + "&per_page=5&page=1"
            )

            if pulls.ValueKind != JsonValueKind.Array || pulls.GetArrayLength() > 5 {
                throw CliFailure("invalid_state", "Cannot read bounded draft PRs")
            }

            if pulls.GetArrayLength() == 5 {
                row["drafts_truncated"] = true
                Truncated = true
            }

            for pull in J.Items(pulls) {
                numbers.Add(J.Number(pull, "number"))
            }
        }

        for number in numbers {
            if number != 0 {
                let canonical = GitHub.Api("repos/" + Repo + "/pulls/" + number.ToString())

                if J.Number(canonical, "number") != number {
                    throw CliFailure("invalid_state", "Canonical PR number differs from discovery")
                }

                Draft(issue, canonical, state, approval, policy, drafts)
            }
        }

        row["drafts_status"] = drafts.Count == 0 ? "absent": "observed"
    }

    private func Reservation(row Dictionary[string, Object?], state CoordinationState) {
        let reservation = J.Get(state.Value(), "reservation")

        if reservation.ValueKind != JsonValueKind.Object {
            row["reservation"] = nil
            return
        }

        let displayed = J.Select(reservation, "reservation,lease,donor,actor,created,expires,status,attempt")
        displayed["expired"] = CoordinationState.Unix(reservation, "expires") <= DateTimeOffset
            .UtcNow
            .ToUnixTimeSeconds()
        displayed["local_process"] = "unknown; a remote lease does not prove a local process is running"
        row["reservation"] = displayed

        try {
            LeaseLifecycle.Owner(state, J.Get(reservation, "actor"))
        } catch (error CliFailure) when error.Code == "stale_approval" { }
    }

    private func Draft(
        issue int32,
        pull JsonElement,
        state CoordinationState,
        approval JsonElement,
        policy JsonElement,
        drafts List[Object]
    ) {
        let number = J.Number(pull, "number")
        let head = J.Get(pull, "head")
        let base = J.Get(pull, "base")
        let recorded = J.Number(J.Get(CoordinationState.Current(state.Value()), "outcome"), "pr")

        if number < 1 || !RepositoryIdentity.SameRepo(J.Text(J.Get(base, "repo"), "full_name"), Repo) ||
            RepositoryIdentity.PositiveId(J.Get(J.Get(base, "repo"), "id")) != RepositoryIdentity.PositiveId(
            J.Get(Info, "id")
        ) ||
            (recorded > 0 && recorded != number) {
            throw CliFailure("invalid_state", "Canonical PR upstream identity differs")
        }

        let sha = RepositoryIdentity.CommitSha(J.Text(head, "sha"))
        let draft = map[string, Object?]{
            "pr": number,
            "url": J.Text(pull, "html_url"),
            "head": sha,
            "state": J.Text(pull, "state"),
            "draft": J.Bool(pull, "draft"),
            "lifecycle": "unknown",
            "binding": "unknown",
            "receipt": "incomplete",
            "checks_status": "unknown",
            "review_status": "unknown",
            "next": Next("owner", "Inspect the PR and its current binding.", View(number.ToString()))
        }
        drafts.Add(draft)

        if J.Text(pull, "state") == "closed" {
            Observe(
                draft,
                "history",
                async () -> {
                    let bound = HistoricalBinding(pull, state, approval)
                    draft["binding"] = bound ? "historical": "mismatch"
                    if bound {
                        draft["receipt"] = "historical identity matched; current readiness is not established"
                        draft["history_status"] = "observed"
                    }
                }
            )

            Observe(draft, "remote", async () -> Reobserve(pull, draft))

            if Text(draft, "binding") == "historical" && Text(draft, "remote_status") == "observed" {
                let merged = J.Get(pull, "merged")
                if merged.ValueKind == JsonValueKind.True {
                    draft["lifecycle"] = "merged"
                } else if merged.ValueKind == JsonValueKind.False && J.Text(pull, "merged_at") == "" {
                    draft["lifecycle"] = "closed_unmerged"
                }
            }

            return
        }

        if J.Text(pull, "state") != "open" {
            throw CliFailure("invalid_state", "Unknown canonical PR lifecycle")
        }

        let bound = Admission.DonorBinding(Repo, pull, state, requireLease: false).ValueKind == JsonValueKind.Object
        draft["binding"] = bound ? "canonical": "mismatch"

        if !bound {
            return
        }

        try {
            let receipt = PrBody.Receipt(J.Text(pull, "body"))
            var complete = J.Number(receipt, "version") == 2 && RepositoryIdentity.SameRepo(
                J.Text(receipt, "repo"),
                Repo
            ) &&
                J.Number(receipt, "issue") == issue && J.Text(receipt, "head") == sha && J.Get(
                state.Value(),
                "contribution"
            )
                .ValueKind == JsonValueKind.Object

            for key in[]string{"approval", "expected", "reservation", "donor"} {
                complete = complete && J.Text(receipt, key) != ""
            }

            if complete {
                draft["receipt"] = J.Bool(
                    receipt,
                    "incomplete"
                ) ? "incomplete": "unverified; completed-work readiness requires receipt verification and owner review"
            }
        } catch (error Exception) when Expected(error) { }

        if policy.ValueKind == JsonValueKind.Object {
            Observe(draft, "checks", async () -> CheckHead(sha, policy, draft))
        } else {
            draft[
                "checks_reason"
            ] = "Current required-check policy is unknown because approval is stale or unavailable."
        }

        Observe(draft, "review", async () -> Reviews(number, sha, draft))
        Observe(draft, "remote", async () -> Reobserve(pull, draft))

        if Text(draft, "remote_status") == "observed" {
            draft["lifecycle"] = "open"
        }
    }

    private func HistoricalBinding(pull JsonElement, state CoordinationState, approval JsonElement) bool {
        let head = J.Get(pull, "head")
        let fork = J.Get(head, "repo")
        RepositoryIdentity.PositiveId(J.Get(fork, "id"))

        let owner = J.Get(fork, "owner")
        let receipt = PrBody.Receipt(J.Text(pull, "body"))
        let value = state.Value()
        let contribution = J.Get(value, "contribution")

        if contribution.ValueKind != JsonValueKind.Object {
            throw CliFailure("invalid_state", "Historical contribution evidence is unavailable")
        }

        let current = CoordinationState.Current(value)
        let outcome = J.Get(current, "outcome")
        let metadata = J.Get(contribution, "metadata")
        let donor = RepositoryIdentity.Login(J.Text(contribution, "donor"))
        let actor = RepositoryIdentity.PositiveId(J.Get(contribution, "actor"))
        let branch = RepositoryIdentity.Branch(J.Text(metadata, "branch"))
        let repository = RepositoryIdentity.Repo(J.Text(metadata, "fork"))

        if J.Number(outcome, "pr") != J.Number(pull, "number") || J.Text(outcome, "head") != J.Text(head, "sha") ||
            J.Number(J.Get(contribution, "outcome"), "pr") != J.Number(pull, "number") || RepositoryIdentity.PositiveId(
            J.Get(current, "actor")
        ) != actor ||
            !String.Equals(J.Text(current, "donor"), donor, StringComparison.OrdinalIgnoreCase) || !RequestData.Same(
            receipt,
            ContributionReceipt.FromState(value)
        ) ||
            J.Text(metadata, "head") != J.Text(J.Get(contribution, "outcome"), "head") {
            return false
        }

        let live = GitHub.Api("repos/" + repository)

        RepositoryAccess.ValidateRepository(
            Repo,
            repository,
            J.Parse(actor.ToString()),
            live,
            push: false,
            upstream: Info
        )

        return J.Text(J.Get(pull, "base"), "ref") == J.Text(approval, "base_branch") && J.Text(head, "ref") == branch &&
            RepositoryIdentity.PositiveId(J.Get(live, "id")) == RepositoryIdentity.PositiveId(J.Get(fork, "id")) &&
            RepositoryIdentity.SameRepo(J.Text(fork, "full_name"), repository) && RepositoryIdentity.PositiveId(
            J.Get(owner, "id")
        ) == actor &&
            String.Equals(J.Text(owner, "login"), donor, StringComparison.OrdinalIgnoreCase)
    }

    private func Reobserve(pull JsonElement, draft Dictionary[string, Object?]) {
        let latest = GitHub.Api("repos/" + Repo + "/pulls/" + J.Number(pull, "number").ToString())
        draft["remote_status"] = "observed"

        for key in[]string{"number", "state", "draft", "merged", "merged_at", "body"} {
            if !RequestData.Same(J.Get(latest, key), J.Get(pull, key)) {
                draft["remote_status"] = "stale"
            }
        }

        for side in[]string{"base", "head"} {
            let now = J.Get(latest, side)
            let then = J.Get(pull, side)
            let repo = J.Get(J.Get(now, "repo"), "id").ToString()

            if J.Text(now, "ref") != J.Text(then, "ref") || repo != J.Get(J.Get(then, "repo"), "id").ToString() {
                draft["remote_status"] = "stale"
            }
        }

        if J.Text(J.Get(latest, "head"), "sha") != J.Text(J.Get(pull, "head"), "sha") {
            draft["remote_status"] = "stale"
        }
    }

    private func Bucket(check JsonElement) string -> J.Text(check, "state") == "ACTION_REQUIRED" ? "blocked": J.Text(
        check,
        "bucket"
    )

    private func CheckHead(head string, policy JsonElement, draft Dictionary[string, Object?]) {
        let observed = List[Object]()
        draft["checks"] = observed
        draft["checks_head"] = head

        let checks = J.Items(CommitChecks.Read(Repo, head, observed))
        let required = List[Object]()
        let displayed = List[Object]()
        var failed bool
        var pending bool
        var blocked bool

        for check in checks {
            let bucket = Bucket(check)
            blocked = blocked || bucket == "blocked"
            failed = failed || bucket == "fail" || bucket == "cancel"
            pending = pending || (bucket != "pass" && bucket != "skipping" && bucket != "fail" && bucket != "cancel")

            if displayed.Count == 16 {
                draft["checks_truncated"] = true
                Truncated = true
            } else {
                displayed.Add(
                    map[string, Object?]{
                        "name": PublicOutput.Prose(J.Text(check, "name"), ref Truncated),
                        "state": J.Text(check, "state"),
                        "bucket": bucket,
                        "link": J.Text(check, "link")
                    }
                )
            }
        }

        for name in J.Items(J.Get(policy, "required_checks")) {
            var status = "missing"
            for check in checks {
                let bucket = Bucket(check)

                if J.Text(check, "name") != name.GetString() || status == "failed" {
                    continue
                }

                if bucket == "fail" || bucket == "cancel" {
                    status = "failed"
                } else if bucket == "blocked" || status == "blocked" {
                    status = "blocked"
                } else {
                    status = bucket == "pass" ? "passed": "pending"
                }
            }

            failed = failed || status == "failed"
            pending = pending || status == "pending" || status == "missing"
            required.Add(
                map[string, Object?]{
                    "name": PublicOutput.Prose(name.GetString() ?? "", ref Truncated),
                    "status": status
                }
            )
        }

        if blocked {
            draft["owner_inspection_required"] = true
        }

        draft["checks_status"] = failed ? "failed": (blocked ? "blocked": (pending ? "pending": "passed"))
        draft["required_checks"] = required
        draft["checks"] = displayed
        draft["workflow_wait_reason"] = "unknown; check status alone does not identify fork-workflow approval waiting"
    }

    private func Reviews(pr int32, head string, draft Dictionary[string, Object?]) {
        let reviews = GitHub.Api("repos/" + Repo + "/pulls/" + pr.ToString() + "/reviews?per_page=30&page=1")

        if reviews.ValueKind != JsonValueKind.Array || reviews.GetArrayLength() > 30 {
            throw CliFailure("invalid_state", "Cannot read bounded PR reviews")
        }

        let current = Dictionary[string, string]()

        for review in J.Items(reviews) {
            let reviewer = J.Text(J.Get(review, "user"), "login")
            let reviewState = J.Text(review, "state")

            if J.Text(review, "commit_id") == head &&
                !((reviewState == "COMMENTED" || reviewState == "PENDING") && current.ContainsKey(reviewer)) {
                current[reviewer] = reviewState
            }
        }

        let rows = List[Object]()

        for reviewer in current.Keys {
            rows.Add(map[string, Object?]{"reviewer": reviewer, "state": current[reviewer]})
        }

        let full = reviews.GetArrayLength() == 30
        draft["reviews"] = rows
        draft["review_status"] = full ? "unknown": (
            current.ContainsValue("CHANGES_REQUESTED") ? "changes_requested": (
                current.ContainsValue("APPROVED") ? "approval_recorded": "owner_review_required"
            )
        )
        draft["review_evidence"] = "GitHub reviews on the observed head; owner acceptance is not verified"

        if full {
            draft["reviews_truncated"] = true
            Truncated = true
        }
    }

    private func ActionFor(
        row Dictionary[string, Object?],
        drafts List[Object],
        state CoordinationState,
        policy JsonElement
    ) {
        let issue = Text(row, "issue")
        let target = Repo + "#" + issue
        let push = J.Bool(J.Get(Info, "permissions"), "push")
        let eligibility = Text(row, "eligibility_status")
        var stage = "approval_waiting"
        var next = Next(
            "owner",
            Text(row, "approval_reason") == "" ? "Approve the issue under the current task fields.": Text(
                row,
                "approval_reason"
            ),
            []string{"tokate", "approve", target}
        )

        if Text(row, "approval_status") == "current" {
            if eligibility == "eligible" || (eligibility == "access_waiting" && push) {
                stage = "reservation_needed"
                next = Next(
                    "donor",
                    eligibility == "eligible" ?
                    "Start work with tokate work " +
                        target +
                        " and your selected profile or model and an explicit time budget.":
                    "An eligible donor must select the task and start work with tokate work " +
                        target +
                        ". Inspect donor access if no donor is eligible.",
                    []string{"tokate", "work", target}
                )
            } else {
                stage = "access_waiting"
                next = Next(
                    "owner",
                    "Review donor access and grant eligibility if appropriate.",
                    []string{"tokate", "access", "list", Repo}
                )

                if Text(row, "viewer_denied") != "True" && !push && !Requested(issue) {
                    next = Next(
                        "donor",
                        "Request owner review for the required donor access.",
                        AccessState.Mode(policy) == "trusted" ? []string{
                            "tokate",
                            "access",
                            "request",
                            target,
                            "--trust"
                        }:
                        []string{"tokate", "access", "request", target}
                    )
                }
            }

            let reservation = J.Get(state.Value(), "reservation")

            if reservation.ValueKind == JsonValueKind.Object && J.Text(reservation, "status") != "released" &&
                CoordinationState.Unix(reservation, "expires") > DateTimeOffset.UtcNow.ToUnixTimeSeconds() {
                stage = J.Text(reservation, "status") == "paused" ? "paused": "claim_accepted"
                next = stage == "paused" ? Next(
                    "donor",
                    "This claim is paused. The donor checks their saved work on their own machine."
                ):
                Next(
                    "donor",
                    "This claim has been accepted. The donor can start work with tokate work " +
                        target +
                        " on their own machine.",
                    []string{"tokate", "work", target}
                )
            } else if reservation.ValueKind == JsonValueKind.Object {
                stage = "lease_expired_or_released"
                next = Next(
                    "donor",
                    "Use tokate work " +
                        target +
                        " for a fresh donation if eligible. Inspect saved work before choosing a separately authorized continuation.",
                    []string{"tokate", "work", target}
                )
            }

            if Text(row, "holder_eligible") == "False" {
                stage = "access_waiting"
                next = Next(
                    "owner",
                    "Restore eligibility for the recorded donor before further work or publication.",
                    []string{"tokate", "access", "list", Repo}
                )
            }

            for item in drafts {
                let draft = item as Dictionary[string, Object?] ?? throw Exception("Invalid status draft")
                let view = View(Text(draft, "pr"))
                let checks = Text(draft, "checks_status")
                let inspect = "GitHub reports action_required without an approval reason; inspect the linked PR or Actions run."

                if Text(draft, "state") == "closed" {
                    continue
                }

                next = Next("owner", "Inspect the PR and Actions links.", view)

                if Text(draft, "binding") != "canonical" {
                    stage = "binding_mismatch"
                } else if Text(draft, "remote_status") == "stale" {
                    stage = "stale_remote_data"
                } else if checks == "blocked" {
                    stage = "ci_blocked"
                    next = Next("owner", inspect, view)
                } else if checks == "failed" {
                    stage = "ci_failed"
                    next = Text(draft, "owner_inspection_required") == "True" ? Next("owner", inspect, view): Next(
                        "donor",
                        "Inspect failed checks and repair the contribution using the donor's own saved work.",
                        view
                    )
                } else if checks == "pending" {
                    stage = "ci_pending"
                    next = Next(
                        "owner",
                        "CI is pending or required checks are missing; inspect the PR or linked Actions run for the reason.",
                        view
                    )
                } else if Text(draft, "review_status") == "changes_requested" {
                    stage = "review_changes_requested"
                    next = Next("donor", "Address the recorded review changes using the donor's own saved work.", view)
                } else if Text(draft, "receipt") == "incomplete" {
                    stage = "incomplete_draft"
                    next = Next(
                        "donor",
                        "Complete the contribution and receipt using the donor's own saved work; its run directory is unknown."
                    )
                } else {
                    stage = "owner_review"
                    next = Next(
                        "owner",
                        "Check the recorded receipt and CI before reviewing acceptance; status does not establish readiness.",
                        []string{"tokate", "checks", Repo + "#" + Text(draft, "pr")}
                    )
                }

                if checks == "unavailable" ||
                    Text(draft, "review_status") == "unavailable" ||
                    Text(draft, "remote_status") == "unavailable" {
                    stage = "unavailable"
                    next = Next("owner", "Inspect unavailable PR or Actions data before proceeding.", view)
                }

                draft["next"] = next
            }
        }

        for item in drafts {
            let draft = item as Dictionary[string, Object?] ?? throw Exception("Invalid status draft")

            if Text(draft, "state") != "closed" {
                continue
            }

            stage = "unknown"
            next = Next("owner", "Inspect the PR and its historical contribution evidence.", View(Text(draft, "pr")))

            if Text(draft, "history_status") == "unavailable" || Text(draft, "remote_status") == "unavailable" {
                stage = "unavailable"
            } else if Text(draft, "remote_status") == "stale" {
                stage = "stale_remote_data"
                next = Next(
                    "owner",
                    "Refresh status; the PR changed during this read.",
                    []string{"tokate", "status", target}
                )
            } else if Text(draft, "binding") == "mismatch" {
                stage = "binding_mismatch"
            } else if Text(draft, "lifecycle") == "merged" || Text(draft, "lifecycle") == "closed_unmerged" {
                let merged = Text(draft, "lifecycle") == "merged"
                stage = merged ? "merged_contribution": "closed_unmerged_contribution"
                next = Next(
                    "owner",
                    merged ?
                    "Review the remaining open issue and approve follow-up work if needed; this contribution is already merged.":
                    "Review the remaining open issue and approve further work if needed; this contribution was closed without merging.",
                    []string{"gh", "issue", "view", issue, "--repo", Repo}
                )
                let reservation = J.Get(state.Value(), "reservation")
                if !merged && reservation.ValueKind == JsonValueKind.Object && RepositoryIdentity.PositiveId(
                    J.Get(reservation, "actor")
                ) == RepositoryIdentity.PositiveId(J.Get(J.Get(state.Value(), "contribution"), "actor")) && J.Text(
                    reservation,
                    "status"
                ) != "released" &&
                    CoordinationState.Unix(reservation, "expires") > DateTimeOffset.UtcNow.ToUnixTimeSeconds() {
                    next = Next(
                        "donor",
                        "This contribution was closed without merging. Use tokate release to free its active reservation.",
                        []string{"tokate", "release", target}
                    )
                }
            }

            draft["next"] = next
        }

        var unavailable bool

        for part in[]string{"approval", "coordination", "eligibility", "drafts", "remote"} {
            unavailable = unavailable || Text(row, part + "_status") == "unavailable"
        }

        if unavailable {
            stage = "unavailable"
            next = Next("owner", "Inspect unavailable remote records before proceeding.")
        } else if Text(row, "remote_status") == "stale" {
            stage = "stale_remote_data"
            next = Next(
                "owner",
                "Refresh contribution status; the authority changed during this read.",
                []string{"tokate", "status", target}
            )
        }

        row["state"] = stage
        row["next"] = next

        if stage == "reservation_needed" || stage == "claim_accepted" {
            Local(row, target, stage)
        }
    }

    private func Local(row Dictionary[string, Object?], target string, stage string) {
        let viewer = J.Get(Viewer, "id").ToString()
        let holder = row["reservation"] is Dictionary[string, Object?]reservation ? Text(reservation, "actor"): ""
        let run = RunReference.Pick(RunReference.Recent(Saved.For(Repo, Int32.Parse(Text(row, "issue")))))

        if run == nil || viewer == "" || J.Get(run.Value, "donor_id").ToString() != viewer ||
            (stage == "claim_accepted" ? holder != viewer: run.Text("state") != "claim_pending") {
            return
        }

        var next Object?

        if run.Busy() {
            row["next"] = Next("donor", "Your tokate work for this issue is running on this machine.")
        } else if run.Text("state") == "claim_pending" {
            row["next"] = Submission.PendingWorkflow(run.Location, Data.Load(run.Location)) ??
                Next(
                "donor",
                "Your claim is pending. Check the coordinator outcome with tokate work. If the Tokate workflow failed: " +
                    ApiTransport.MutationRecovery,
                []string{"tokate", "work", target}
            )
        } else if PublicOutput.RunSummary(run.Location).TryGetValue("next", out next) {
            row["next"] = next
        } else if run.Next == "submit" {
            row["next"] = Next("donor", "Submit your verified saved work.", []string{"tokate", "submit", target})
        }
    }

    private func Requested(issue string) bool {
        for request in Requests {
            if J.Number(request, "issue") == Int32.Parse(issue) && RepositoryIdentity.PositiveId(
                J.Get(request, "actor")
            ) == RepositoryIdentity.PositiveId(J.Get(Viewer, "id")) {
                return true
            }
        }

        return false
    }

    private func Read(args Args) {
        Repo = RepositoryIdentity.Repo(args.Need("repo"))
        let issue = args.Get("issue") == "" ? 0: args.Number("issue")

        Result["repo"] = Repo
        Result["remote_status"] = "unknown"
        Result["work"] = Work
        Result["discovery_limit"] = 20
        Result["next"] = Next("owner", "Inspect unavailable remote records.")

        if !Observe(
            Result,
            "repository",
            async () -> {
                Info = GitHub.Api("repos/" + Repo)
                RepositoryIdentity.PositiveId(J.Get(Info, "id"))

                if !RepositoryIdentity.SameRepo(J.Text(Info, "full_name"), Repo) {
                    throw CliFailure("stale_approval", "Repository identity changed")
                }

                Result["repository_status"] = "observed"
                GratisRepo = GitHub.Api(
                    "repos/" + Repo + "/contents/.github/tokate.json?ref=" + J.Text(Info, "default_branch"),
                    missing: true
                )
                    .ValueKind == JsonValueKind.Undefined
            }
        ) {
            return
        }

        Observe(
            Result,
            "viewer",
            async () -> {
                Viewer = GitHub.Api("user")
                Result["viewer"] = map[string, Object?]{
                    "donor": RepositoryIdentity.Login(J.Text(Viewer, "login")),
                    "actor": RepositoryIdentity.PositiveId(J.Get(Viewer, "id")),
                    "role": J.Bool(J.Get(Info, "permissions"), "push") ? "owner": "donor"
                }
                Result["viewer_status"] = "observed"
            }
        )

        Observe(
            Result,
            "access",
            async () -> {
                Access = AccessState.Load(Repo, RepositoryIdentity.PositiveId(J.Get(Info, "id")))
                Result["access_status"] = Access?.Sha == "" ? "absent": "observed"
                Result["access_sha"] = Access?.Sha
            }
        )

        Result["requests_status"] = "unknown"

        if let access = Access {
            Observe(
                Result,
                "requests",
                async () -> {
                    Result["requests_truncated"] = AccessState.Pending(Repo, access, Requests, issue, bounded: true)
                    Result["requests_status"] = "observed"
                }
            )
        }

        let displayed = List[Object]()
        let review = Next(
            "owner",
            "Review donor access and use approve ISSUE LOGIN or grant trust if appropriate.",
            []string{"tokate", "access", "list", Repo}
        )

        for request in Requests {
            if displayed.Count == 20 {
                Result["requests_truncated"] = true
                break
            }

            let row = J.Select(request, "comment,actor,donor,issue,scope")
            row["next"] = review
            displayed.Add(row)
        }

        Result["pending_requests"] = displayed
        Result["pending_requests_observed"] = Requests.Count
        Truncated = Truncated || Text(Result, "requests_truncated") == "True"

        if issue != 0 {
            Result["coordination"] = nil
            Observe(
                Result,
                "coordination",
                async () -> {
                    let state = CoordinationState.Load(Repo, issue, missing: true)
                    Result["coordination"] = state.Sha == "" ? nil: PublicOutput.Coordination(state.Value(), state.Sha)
                }
            )
        }

        Observe(
            Result,
            "discovery",
            async () -> {
                if issue != 0 {
                    Issue(GitHub.Api("repos/" + Repo + "/issues/" + issue.ToString()))
                } else {
                    let issues = GitHub.Api(
                        "repos/" +
                            Repo +
                            "/issues?state=open&" +
                            (GratisRepo ? "": "labels=tokate%3Aapproved&") +
                            "sort=updated&direction=desc&per_page=20&page=1"
                    )

                    if issues.ValueKind != JsonValueKind.Array || issues.GetArrayLength() > 20 {
                        throw CliFailure("invalid_state", "Cannot read bounded approved-work issues")
                    }

                    Result["discovery_truncated"] = issues.GetArrayLength() == 20
                    Truncated = Truncated || issues.GetArrayLength() == 20

                    for task in J.Items(issues) {
                        if J.Get(task, "pull_request").ValueKind == JsonValueKind.Undefined && J.Text(
                            task,
                            "state"
                        ) == "open" &&
                            (GratisRepo || GitHub.HasLabel(task)) {
                            let row = Issue(task)
                            if Text(row, "approval_status") == "absent" {
                                Work.Remove(row)
                            }
                        }
                    }
                }

                Result["discovery_status"] = "observed"
            }
        )

        if Access != nil {
            Observe(
                Result,
                "access",
                async () -> {
                    let reference = GitHub.Api("repos/" + Repo + "/git/ref/heads/tokate/access", missing: true)
                    if J.Text(J.Get(reference, "object"), "sha") != Access?.Sha {
                        Result["access_status"] = "stale"
                        Result["requests_status"] = "stale"

                        for item in Work {
                            let row = item as Dictionary[string, Object?] ?? throw Exception("Invalid status work")

                            row["eligibility_status"] = "stale"
                            row["state"] = "stale_remote_data"
                            row["next"] = Next(
                                "owner",
                                "Refresh status; donor access changed during this read.",
                                []string{"tokate", "status", Repo + "#" + Text(row, "issue")}
                            )
                        }
                    }
                }
            )
        }

        var stale = Text(Result, "access_status") == "stale"

        for item in Work {
            let row = item as Dictionary[string, Object?] ?? throw Exception("Invalid status work")
            stale = stale || Text(row, "remote_status") == "stale" || Text(row, "state") == "stale_remote_data"
        }

        Result["remote_status"] = Failure != nil ? "unavailable": (stale ? "stale": "observed")
        Result["next"] = displayed.Count > 0 ? review: (
            Work.Count > 0 ? (Work[0] as Dictionary[string, Object?])?["next"]: Next(
                "owner",
                "No approved work was observed within the bounded index."
            )
        )
    }

    private func Text(value Dictionary[string, Object?], key string) string -> value.ContainsKey(key) ? value[
        key
    ]?.ToString() ?? "": ""

    shared {
        internal func Run(args Args) {
            let status = ContributionStatus()

            try {
                status.Read(args)
            } catch (error Exception) when status.Expected(error) || error is ApiDeadlineException {
                status.Failure = status.Failure ?? status.Failed(error)
            }

            if status.Failure != nil {
                status.Result["remote_status"] = "unavailable"
                status.Result["next"] = status.Next(
                    "owner",
                    "Inspect unavailable required remote records before proceeding."
                )
            }

            status.Result["work_observed"] = status.Work.Count
            let outcomes = Dictionary[string, string]()

            for item in status.Work {
                let row = item as Dictionary[string, Object?] ?? throw Exception("Invalid status row")
                if row.ContainsKey("drafts") && row["drafts"] is List[Object]drafts {
                    for entry in drafts {
                        let draft = entry as Dictionary[string, Object?] ?? throw Exception("Invalid status draft")
                        let lifecycle = status.Text(draft, "lifecycle")

                        if lifecycle == "merged" || lifecycle == "closed_unmerged" {
                            outcomes[status.Text(draft, "pr")] = lifecycle == "merged" ? "merged": "closed"
                        }

                        if draft.ContainsKey("checks") && draft["checks"] is List[Object]checks && checks.Count > 16 {
                            draft["checks_observed"] = checks.Count
                            checks.RemoveRange(16, checks.Count - 16)
                            draft["checks_truncated"] = true
                            status.Truncated = true
                        }
                    }
                }
            }

            while System.Text.Encoding.UTF8.GetByteCount(J.Write(status.Result)) > 56000 && status.Work.Count > 0 {
                status.Work.RemoveAt(status.Work.Count - 1)
                status.Result["presentation_truncated"] = true
                status.Truncated = true
            }

            status.Result["truncated"] = status.Truncated

            if args.Get("issue") != "" {
                let attempts = RunReference.Recent(status.Saved.For(args.Get("repo"), args.Number("issue")))

                for attempt in attempts {
                    let pr = J.Number(attempt.Value, "pr").ToString()

                    if outcomes.ContainsKey(pr) {
                        attempt.Outcome = outcomes[pr]
                    }
                }

                status.Result["attempts"] = SavedRuns.Summary(attempts, 0)["runs"]
            }

            PublicOutput.ResultData = status.Result
            PublicOutput.Truncated = status.Truncated
            PublicOutput.Actions.Clear()

            if status.Result["next"] is Dictionary[string, Object?]next &&
                next["command"] is []string command &&
                command.Length > 0 {
                PublicOutput.Actions.Add(command)
            }

            if !PublicOutput.Enabled {
                Print(J.Parse(J.Write(status.Result)), args.Get("issue") == "")
            }

            if let failure = status.Failure {
                throw failure
            }
        }

        internal func Attempt(options Args) {
            let directory = PublicOutput.RunDirectory
            let summary = PublicOutput.RunSummary(directory)
            let run = SavedRun(directory, Data.Load(directory).Element(), true)
            RunReference.Outcomes(List[SavedRun]{run})

            if run.Outcome != "" {
                summary["outcome"] = run.Outcome
                summary["finished"] = true
            }

            summary["busy"] = run.Busy()
            PublicOutput.ResultData = summary

            if !PublicOutput.Enabled {
                PublicOutput.Next(options, "")
                Print(J.Parse(J.Write(summary)))
            }
        }

        internal func Print(value JsonElement, repository bool = false) {
            let repo = J.Text(value, "repo")
            let work = J.Get(value, "work")

            if work.ValueKind != JsonValueKind.Array {
                var next = Action(J.Get(value, "next"))

                for action in PublicOutput.Actions {
                    if action.Length > 1 && action[1] != "status" {
                        next = Terminal.Hint(action)
                        break
                    }
                }

                let issue = J.Get(value, "issue").ToString()
                let correction = J.Get(value, "correction")
                var state = J.Text(value, "outcome") != "" ? J.Text(value, "outcome"): J.Text(value, "state")
                var reason = J.Text(J.Get(value, "error"), "message")

                if J.Text(correction, "state") != "" {
                    state += ", correction " + J.Text(correction, "state")
                    reason = reason == "" ? J.Text(J.Get(correction, "error"), "message"): reason
                }

                Table(
                    repo == "" ? "": repo + (issue == "" ? "": "#" + issue),
                    state + (reason == "" ? "": ": " + reason),
                    J.Text(value, "pr_url"),
                    next
                )
                let checkout = J.Text(J.Get(value, "artifacts"), "checkout")
                if checkout != "" {
                    Cell("Path", checkout, "default")
                }
                return
            }

            let observed = J.Text(value, "remote_status") == "observed"

            if repository {
                Repository(value, J.Items(work), observed)
                return
            }

            for row in J.Items(work) {
                let drafts = J.Items(J.Get(row, "drafts"))
                Table(
                    repo + "#" + J.Number(row, "issue").ToString(),
                    J.Text(row, "state"),
                    drafts.Count == 0 ? "": J.Text(drafts[drafts.Count - 1], "url"),
                    Action(J.Get(J.Count(work) == 1 || !observed ? value: row, "next"))
                )
            }

            if J.Count(work) == 0 {
                Table(
                    repo,
                    observed ? "no_work_observed": J.Text(value, "remote_status"),
                    "",
                    Action(J.Get(value, "next"))
                )
            }
        }

        private func Repository(value JsonElement, work List[JsonElement], observed bool) {
            if !observed || work.Count == 0 {
                Cell("State", observed ? "no_work_observed": J.Text(value, "remote_status"), "yellow")
            }

            if !observed || work.Count == 0 || J.Count(J.Get(value, "pending_requests")) > 0 {
                Cell("Next", Action(J.Get(value, "next")), "default")
            }

            if work.Count > 0 {
                let viewer = J.Get(value, "viewer")
                let me = J.Get(viewer, "actor").ToString()
                let table = List[[]string]{[]string{"ISSUE", "TITLE", "STATE", "YOU"}}

                for task in work {
                    let next = J.Get(task, "next")
                    let role = J.Text(next, "role")
                    let reservation = J.Get(task, "reservation")
                    let holder = J.Bool(reservation, "expired") || J.Text(reservation, "status") == "released" ? "":
                    J.Get(reservation, "actor").ToString()
                    let eligible = J.Text(task, "eligibility_status") == "eligible"
                    let mine = role == "donor" ? (
                        holder == "" ? J.Text(viewer, "role") == "donor" || eligible: holder == me
                    ):
                    role == J.Text(viewer, "role")
                    table.Add(
                        []string{
                            "#" + J.Number(task, "issue").ToString(),
                            J.Text(task, "title"),
                            J.Text(task, "state"),
                            J.Text(viewer, "role") == "" ? "?": mine ? "yes": "no"
                        }
                    )
                    table.Add([]string{"Next: " + Action(next)})
                }

                Terminal.Table(table, fit: 1)
            }

            if J.Bool(value, "truncated") {
                Terminal.Message("Bounded snapshot: some data was omitted.", "default")
            }
        }

        private func Action(next JsonElement) string {
            let command = Terminal.Hint(J.Items(J.Get(next, "command")).ConvertAll(word -> word.ToString()).ToArray())
            return command == "" ? J.Text(next, "action"): command
        }

        private func Table(issue string, state string, pr string, next string) {
            Cell("Issue", issue, "default")
            Cell("State", state, state.Contains("failed") ? "red": "yellow")
            Cell("PR", pr, "default")
            Cell("Next", next, "default")
        }

        private func Cell(label string, value string, color string) -> Terminal.Line(
            Terminal.Clean(label.PadRight(7) + (value == "" ? "none": value)).Replace('\n', ' '),
            color,
            false
        )
    }
}
