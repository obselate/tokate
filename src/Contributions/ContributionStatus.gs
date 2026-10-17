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
        CliFailure("command_failed", error.Message, summary: CliFailure.Message("command_failed"))

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
            "title": Output.Prose(J.Text(task, "title"), ref Truncated),
            "url": GitHub.WebUrl + Repo + "/issues/" + issue.ToString(),
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
        if GratisRepo || (run != nil && run.Run.Gratis) {
            row["approval_status"] = "not_required"
            row["eligibility_status"] = "not_required"
            row["coordination_status"] = "not_required"
            row["drafts_status"] = "not_observed"
            row["state"] = run != nil && run.Run.Gratis ? run.State: J.Text(task, "state")
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

        let loaded = Observe(
            row,
            "coordination",
            async () -> {
                state = CoordinationState.Load(Repo, issue, missing: true)
                row["coordination_status"] = state.Sha == "" ? "absent": "observed"
                row["state_sha"] = state.Sha
                if state.Sha != "" {
                    approval = state.Approval?.Value() ?? default(JsonElement)
                    row["approval_id"] = state.ApprovalId
                    row["revoked"] = state.Revoked
                    Reservation(row, state)
                }
            }
        )

        if !loaded {
            row["state"] = "unavailable"
            return row
        }

        return ApprovedIssue(task, row, state, approval)
    }

    private func ApprovedIssue(
        task JsonElement,
        row Dictionary[string, Object?],
        state CoordinationState,
        approval JsonElement
    ) Dictionary[string, Object?] {
        let issue = J.Number(task, "number")
        var policy JsonElement

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

        let valid = Observe(
            row,
            "approval",
            async () -> {
                try {
                    row["approval"] = J.Select(
                        approval,
                        "version,approval_scope,eligibility,donor,base,base_branch,authority_branch"
                    )
                    let approved = OwnerApproval.Record.Parse(approval)
                    if !RepositoryIdentity.SameRepo(approved.Repo, Repo) ||
                        approved.Issue != issue ||
                        approved.Version != 2 {
                        throw CliFailure("invalid_state", "Malformed approval identity")
                    }

                    policy = J.Get(state.CheckApproval(Repo, issue, quiet: true), "policy")
                    row["approval_status"] = "current"
                } catch (error CliFailure) when error.Code == "stale_approval" {
                    Stale(row, error)
                }
            }
        )

        Eligibility(row, state, approval, policy, valid)

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

    private func Eligibility(
        row Dictionary[string, Object?],
        state CoordinationState,
        approval JsonElement,
        policy JsonElement,
        valid bool
    ) {
        if Viewer.ValueKind == JsonValueKind.Undefined {
            row["eligibility_status"] = "unavailable"
        } else if valid && Text(row, "approval_status") == "current" {
            try {
                let approved = AccessState.Task(approval)

                if approved.RepoId != RepositoryIdentity.PositiveId(J.Get(Info, "id")) {
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

                for member in Access?.Members ?? List[AccessState.Member]() {
                    if member.Actor == actor {
                        row["viewer_denied"] = member.Denied
                    }
                }

                let reservation = state.Lease
                if reservation != nil {
                    let holder = RepositoryIdentity.PositiveId(reservation.ActorJson)
                    row["holder_eligible"] = Access?.Allows(holder, mode, approval) == true
                }
            } catch (error Exception) when Expected(error) {
                Unavailable(row, "eligibility", error)
            }
        }
    }

    private func Drafts(
        issue int32,
        row Dictionary[string, Object?],
        state CoordinationState,
        approval JsonElement,
        policy JsonElement,
        drafts List[Object]
    ) {
        let metadata = state.Contribution?.Metadata ?? default(JsonElement)
        let handoff = metadata.ValueKind == JsonValueKind.Object ? PublicationRequestMetadata.Parse(metadata)
            .Handoff: JsonElement{}

        if handoff.ValueKind == JsonValueKind.Object {
            row["handoff"] = handoff
        }

        let numbers = List[int32]{state.Current()?.Outcome.Pr ?? 0}
        let reservation = state.Lease
        let donor = reservation?.Donor ?? ""

        if numbers[0] == 0 && donor != "" {
            let branch = GitHub.ContributionBranchPrefix + (reservation?.Reservation ?? "")
            RepositoryIdentity.Login(donor)
            RepositoryIdentity.Branch(branch)

            let pulls = GitHub.Api(
                "repos/" + Repo + "/pulls?state=all&head=" + Uri.EscapeDataString(donor + ":" + branch) +
                    "&base=" +
                    Uri.EscapeDataString(OwnerApproval.Record.Parse(approval).BaseBranch) +
                    "&" +
                    DraftPageParameter +
                    "&page=1"
            )

            if pulls.ValueKind != JsonValueKind.Array || pulls.GetArrayLength() > DraftCountLimit {
                throw CliFailure("invalid_state", "Cannot read bounded draft PRs")
            }

            if pulls.GetArrayLength() == DraftCountLimit {
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
        let reservation = state.Lease

        if reservation == nil {
            row["reservation"] = nil
            return
        }

        let displayed = reservation.Display()
        displayed["expired"] = reservation.Expires <= DateTimeOffset.UtcNow.ToUnixTimeSeconds()
        displayed["local_process"] = "unknown; a remote lease does not prove a local process is running"
        row["reservation"] = displayed

        try {
            LeaseLifecycle.Owner(state, reservation.ActorJson)
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
        let recorded = state.Current()?.Outcome.Pr ?? 0

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
            let complete = receipt.Version == 2 && RepositoryIdentity.SameRepo(receipt.Repo, Repo) &&
                receipt.Issue == issue &&
                receipt.Head == sha &&
                state.Contribution != nil &&
                receipt.Approval != "" &&
                receipt.Expected != "" &&
                receipt.Reservation != "" &&
                receipt.Donor != ""

            if complete {
                draft["receipt"] = receipt.Incomplete.ValueKind == JsonValueKind.True
                ? "incomplete": "unverified; completed-work readiness requires receipt verification and owner review"
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
        let contribution = state.Contribution

        if contribution == nil {
            throw CliFailure("invalid_state", "Historical contribution evidence is unavailable")
        }

        let current = state.Current()
        let outcome = current?.Outcome
        let metadata = contribution.Metadata
        let publication = PublicationRequestMetadata.Parse(metadata)
        let donor = RepositoryIdentity.Login(contribution.Donor)
        let actor = RepositoryIdentity.PositiveId(contribution.ActorJson)
        let branch = RepositoryIdentity.Branch(publication.Branch)
        let repository = RepositoryIdentity.Repo(publication.Fork)

        if (outcome?.Pr ?? 0) != J.Number(pull, "number") || (outcome?.Head ?? "") != J.Text(head, "sha") ||
            contribution
            .Outcome
            .Pr != J.Number(pull, "number") || RepositoryIdentity.PositiveId(
            current?.ActorJson ?? default(JsonElement)
        ) != actor ||
            !String.Equals(current?.Donor ?? "", donor, StringComparison.OrdinalIgnoreCase) || !RequestData.Same(
            receipt.ToJson(),
            ContributionReceipt.FromState(state)
        ) ||
            publication.Head != contribution
            .Outcome
            .Head {
            return false
        }

        let live = GitHub.Api("repos/" + repository)

        RepositoryAccess.ValidateRepository(Repo, repository, actor, live, push: false, upstream: Info)

        return J.Text(J.Get(pull, "base"), "ref") == OwnerApproval.Record.Parse(approval).BaseBranch && J.Text(
            head,
            "ref"
        ) == branch &&
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

            if displayed.Count == CheckCountLimit {
                draft["checks_truncated"] = true
                Truncated = true
            } else {
                displayed.Add(
                    map[string, Object?]{
                        "name": Output.Prose(J.Text(check, "name"), ref Truncated),
                        "state": J.Text(check, "state"),
                        "bucket": bucket,
                        "link": J.Text(check, "link")
                    }
                )
            }
        }

        for name in J.Items(Policy.Parse(policy).RequiredChecks) {
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
                map[string, Object?]{"name": Output.Prose(name.GetString() ?? "", ref Truncated), "status": status}
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
        let reviews = GitHub.Api(
            "repos/" + Repo + "/pulls/" + pr.ToString() + "/reviews?" + ReviewPageParameter + "&page=1"
        )

        if reviews.ValueKind != JsonValueKind.Array || reviews.GetArrayLength() > ReviewCountLimit {
            throw CliFailure("invalid_state", "Cannot read bounded PR reviews")
        }

        let current = map[string, string]{}

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

        let full = reviews.GetArrayLength() == ReviewCountLimit
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
            ApprovedAction(row, state, policy, target, ref stage, ref next)

            OpenDraftActions(drafts, ref stage, ref next)
        }

        ClosedDraftActions(drafts, state, issue, target, ref stage, ref next)

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

    private func ApprovedAction(
        row Dictionary[string, Object?],
        state CoordinationState,
        policy JsonElement,
        target string,
        ref stage string,
        ref next Dictionary[string, Object?]
    ) {
        let issue = Text(row, "issue")
        let push = J.Bool(J.Get(Info, "permissions"), "push")
        let eligibility = Text(row, "eligibility_status")

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
                    AccessState.Mode(policy) == "trusted" ? []string{"tokate", "access", "request", target, "--trust"}:
                    []string{"tokate", "access", "request", target}
                )
            }
        }

        let reservation = state.Lease

        if reservation != nil &&
            reservation.Status != "released" &&
            reservation.Expires > DateTimeOffset
            .UtcNow
            .ToUnixTimeSeconds() {
            stage = reservation.Status == "paused" ? "paused": "claim_accepted"
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
        } else if reservation != nil {
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
    }

    private func OpenDraftActions(drafts List[Object], ref stage string, ref next Dictionary[string, Object?]) {
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

    private func ClosedDraftActions(
        drafts List[Object],
        state CoordinationState,
        issue string,
        target string,
        ref stage string,
        ref next Dictionary[string, Object?]
    ) {
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
                let reservation = state.Lease
                if !merged && reservation != nil && RepositoryIdentity.PositiveId(
                    reservation.ActorJson
                ) == RepositoryIdentity.PositiveId(state.Contribution?.ActorJson ?? default(JsonElement)) &&
                    reservation.Status != "released" &&
                    reservation.Expires > DateTimeOffset
                    .UtcNow
                    .ToUnixTimeSeconds() {
                    next = Next(
                        "donor",
                        "This contribution was closed without merging. Use tokate release to free its active reservation.",
                        []string{"tokate", "release", target}
                    )
                }
            }

            draft["next"] = next
        }
    }

    private func Local(row Dictionary[string, Object?], target string, stage string) {
        let viewer = J.Get(Viewer, "id").ToString()
        let holder = row["reservation"] is Dictionary[string, Object?]reservation ? Text(reservation, "actor"): ""
        let run = SavedRuns.Pick(SavedRuns.Recent(Saved.For(Repo, Int32.Parse(Text(row, "issue")))))

        if run == nil ||
            viewer == "" ||
            run
            .Run
            .DonorId
            .ToString() != viewer ||
            (stage == "claim_accepted" ? holder != viewer: run.Run.State != "claim_pending") {
            return
        }

        var next Object?

        if run.Busy() {
            row["next"] = Next("donor", "Your tokate work for this issue is running on this machine.")
        } else if run.Run.State == "claim_pending" {
            row["next"] = Submission.PendingWorkflow(run.Location, Data.Load(run.Location)) ??
                Next(
                "donor",
                "Your claim is pending. Check the coordinator outcome with tokate work. If the Tokate workflow failed: " +
                    ApiTransport.MutationRecovery,
                []string{"tokate", "work", target}
            )
        } else if Output.Sink.RunSummary(run.Location).TryGetValue("next", out next) {
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
        Result["discovery_limit"] = DiscoveryCountLimit
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
                    "repos/" + Repo + "/contents/" + Policy.FilePath + "?ref=" + J.Text(Info, "default_branch"),
                    missing: true
                )
                    .ValueKind == JsonValueKind.Undefined
            }
        ) {
            return
        }

        ReadAccess(issue)

        let displayed = List[Object]()
        let review = Next(
            "owner",
            "Review donor access and use approve ISSUE LOGIN or grant trust if appropriate.",
            []string{"tokate", "access", "list", Repo}
        )

        for request in Requests {
            if displayed.Count == DiscoveryCountLimit {
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
                    Result["coordination"] = state.Sha == "" ? nil: Output.Sink.Coordination(state, state.Sha)
                }
            )
        }

        Discover(issue)

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

    private func ReadAccess(issue int32) {
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
    }

    private func Discover(issue int32) {
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
                            "sort=updated&direction=desc&" +
                            DiscoveryPageParameter +
                            "&page=1"
                    )

                    if issues.ValueKind != JsonValueKind.Array || issues.GetArrayLength() > DiscoveryCountLimit {
                        throw CliFailure("invalid_state", "Cannot read bounded approved-work issues")
                    }

                    Result["discovery_truncated"] = issues.GetArrayLength() == DiscoveryCountLimit
                    Truncated = Truncated || issues.GetArrayLength() == DiscoveryCountLimit

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
    }

    private func Text(value Dictionary[string, Object?], key string) string -> value.ContainsKey(key) ? value[
        key
    ]?.ToString() ?? "": ""

    shared {
        private const DraftCountLimit int32 = 5

        private const DraftPageParameter string = "per_page=5"

        private const CheckCountLimit int32 = 16

        private const ReviewCountLimit int32 = 30

        private const ReviewPageParameter string = "per_page=30"

        private const DiscoveryCountLimit int32 = 20

        private const DiscoveryPageParameter string = "per_page=20"

        private const PresentationByteLimit int32 = 56000

        internal func Run(args Args) CliFailure? {
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
            let outcomes = map[string, string]{}

            for item in status.Work {
                let row = item as Dictionary[string, Object?] ?? throw Exception("Invalid status row")
                if row.ContainsKey("drafts") && row["drafts"] is List[Object]drafts {
                    for entry in drafts {
                        let draft = entry as Dictionary[string, Object?] ?? throw Exception("Invalid status draft")
                        let lifecycle = status.Text(draft, "lifecycle")

                        if lifecycle == "merged" || lifecycle == "closed_unmerged" {
                            outcomes[status.Text(draft, "pr")] = lifecycle == "merged" ? "merged": "closed"
                        }

                        if draft.ContainsKey("checks") &&
                            draft["checks"] is List[Object]checks &&
                            checks.Count > CheckCountLimit {
                            draft["checks_observed"] = checks.Count
                            checks.RemoveRange(CheckCountLimit, checks.Count - CheckCountLimit)
                            draft["checks_truncated"] = true
                            status.Truncated = true
                        }
                    }
                }
            }

            while System
                .Text
                .Encoding
                .UTF8
                .GetByteCount(J.Write(status.Result)) > PresentationByteLimit &&
                status
                .Work
                .Count > 0 {
                status.Work.RemoveAt(status.Work.Count - 1)
                status.Result["presentation_truncated"] = true
                status.Truncated = true
            }

            status.Result["truncated"] = status.Truncated

            if args.Get("issue") != "" {
                let attempts = SavedRuns.Recent(status.Saved.For(args.Get("repo"), args.Number("issue")))

                for attempt in attempts {
                    let pr = attempt.Run.Pr.ToString()

                    if outcomes.ContainsKey(pr) {
                        attempt.Outcome = outcomes[pr]
                    }
                }

                status.Result["attempts"] = SavedRuns.Summary(attempts, 0)["runs"]
            }

            Output.Sink.ResultData = status.Result
            Output.Sink.Truncated = status.Truncated
            Output.Sink.Actions.Clear()

            if status.Result["next"] is Dictionary[string, Object?]next &&
                next["command"] is []string command &&
                command.Length > 0 {
                Output.Sink.Actions.Add(command)
            }

            return status.Failure
        }

        internal func Attempt(options Args) {
            let directory = Output.Sink.RunDirectory
            let summary = Output.Sink.RunSummary(directory)
            let saved = Data.Load(directory)
            let run = SavedRun(directory, saved.Element(), true, saved)
            SavedRuns.Outcomes(List[SavedRun]{run})

            if run.Outcome != "" {
                summary["outcome"] = run.Outcome
                summary["finished"] = true
            }

            summary["busy"] = run.Busy()
            Output.Sink.ResultData = summary

            if !Output.Sink.Enabled {
                Output.Sink.Next(options, "")
            }
        }
    }
}
