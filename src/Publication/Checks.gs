package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class ChecksObservation {
    var Run Data
    var Previous string = ""
    var Binding string = ""
    var Identity string = ""
    var Stage string = "lifecycle"
    var Approval bool = false
    var Failed bool = false
    var Pending bool = false

    init(run Data) {
        Run = run
    }
}

internal class Checks {
    shared {
        private const BindingFields string = "version,issue,approval,authority_revision,donor,base,base_branch,commit,expected,reservation,receipt_hash,policy_hash"

        private const DefaultTimeoutSeconds string = "1200"

        private func Review(
            passed bool
        ) string -> "Review implementation scope, acceptance criteria, semantic compatibility and limitations; decide final acceptance" +
            (passed ? " and merge": "") +
            ". Machine checks do not accept or complete the issue or remove draft status."

        private const ApprovalAction string = "Workflow runs await owner approval. Inspect the PR diff, then approve the linked runs in GitHub."

        private const ReportAction string = "Require a current public change and verification report bound to this exact commit; publication may preserve the work as a draft."

        private const UnknownApprovalAction string = "Inspect the PR and linked Actions runs for action_required; the cause is unknown. Approve a fork workflow only after explicit approval evidence and diff inspection."

        private func Identity(pull JsonElement) string {
            let result = J.Select(pull, "state,draft,merged,merged_at,closed_at")
            result["head"] = J.Select(J.Get(pull, "head"), "sha,ref")
            result["head_repo"] = J.Select(J.Get(J.Get(pull, "head"), "repo"), "id,full_name")
            result["base"] = J.Select(J.Get(pull, "base"), "ref")
            result["base_repo"] = J.Select(J.Get(J.Get(pull, "base"), "repo"), "id,full_name")
            result["author"] = J.Select(J.Get(pull, "user"), "id,login")
            result["body_hash"] = J.Hash(J.Text(pull, "body"))

            return J.Write(result)
        }

        private func ObserveAfter(pull JsonElement, facts Dictionary[string, Object?]) {
            facts["observed_head_after"] = J.Text(J.Get(pull, "head"), "sha")
            facts["target_branch_after"] = J.Text(J.Get(pull, "base"), "ref")
            facts["pr_observation_after"] = J.Select(pull, "state,draft,merged,merged_at,closed_at")

            if J.Text(pull, "state") == "closed" || J.Bool(pull, "merged") || J.Get(pull, "merged_at")
                .ValueKind == JsonValueKind.String {
                facts["owner_review"] = "historical"
                facts["required_owner_actions"] = []string{}
            } else {
                facts["owner_review"] = "required"
            }
        }

        private func Invalidate(gates Dictionary[string, Object?], facts Dictionary[string, Object?]) {
            for name in[]string{"receipt", "report", "checks", "dependencies", "lifecycle"} {
                let gate = gates[name] as Dictionary[string, Object?] ?? throw Exception("Invalid check gate")
                let status = gate["status"]?.ToString() ?? "unread"

                if status == "passed" || status == "failed" || status == "pending" {
                    gate["observed_status"] = status
                    gate["status"] = "stale"
                }
            }

            facts["checks_observed_status"] = facts["checks_status"]

            if facts["checks_status"]?.ToString() != "unread" {
                facts["checks_status"] = "stale"
            }
        }

        private func Show(
            run Data,
            observed List[Object],
            facts Dictionary[string, Object?],
            directory string,
            verbose bool,
            approval bool,
            render Action[Dictionary[string, Object?]],
            ref previous string
        ) {
            Output.Sink.CheckResult(
                run,
                J.Parse(J.Write(observed)),
                facts["checks_status"]?.ToString() ?? "unread",
                facts
            )
            let view = []string{"gh", "pr", "view", run.Pr.ToString(), "--repo", run.Repo, "--web"}

            if Output.Sink.Enabled {
                Output.Sink.Actions.Clear()

                if approval {
                    Output.Sink.Actions.Add(view)
                }
            }

            let snapshot = J.Write(
                map[string, Object?]{
                    "head": run.ChecksHead == "" ? run.Commit: run.ChecksHead,
                    "status": facts["checks_status"],
                    "checks": observed,
                    "result": Output.Sink.ResultData
                }
            )

            if snapshot == previous {
                return
            }

            if directory != "" {
                let path = Path.Combine(directory, "checks.json")
                if !File.Exists(path) || File.ReadAllText(path) != snapshot {
                    File.WriteAllText(path, snapshot)
                }
            }

            previous = snapshot
            let status = facts["checks_status"]?.ToString() ?? "unread"
            let machine = facts["machine_status"]?.ToString() ?? "pending"

            Output.Sink.Message(
                "Machine gates " + machine,
                machine == "passed" ? "green": (machine == "failed" ? "red": "yellow")
            )
            Output.Sink.Message("Checks " + status + ": " + run.PrUrl, status == "passed" ? "green": "yellow")

            if !Output.Sink.Enabled {
                if approval {
                    Output.Sink.Message(ApprovalAction, "yellow")
                    Output.Sink.Message("Next: " + Output.Sink.Hint(view), "default")
                } else if facts["owner_review"]?.ToString() == "required" {
                    Output.Sink.Message(
                        machine == "passed" ? "Owner review: read the diff, then merge.": "Owner review: read the diff.",
                        "default"
                    )
                }

                if verbose {
                    render(facts)
                }
            }
        }

        internal func Run(args Args, render Action[Dictionary[string, Object?]]) int32 {
            ApiTransport.BeginDeadline(args.Number("timeout", DefaultTimeoutSeconds))

            try {
                return ChecksWithinDeadline(args, render)
            } catch (error ApiDeadlineException) {
                Output.Sink.Message(error.Message, "yellow")

                return Output.PendingExitCode
            } finally {
                ApiTransport.EndDeadline()
            }
        }

        private func ChecksWithinDeadline(args Args, render Action[Dictionary[string, Object?]]) int32 {
            let directory = args.Get("run") == "" ? "": Path.GetFullPath(args.Need("run"))
            let run = directory == "" ? Data(): Data.Load(directory)

            if directory == "" {
                run.Repo = RepositoryIdentity.Repo(args.Need("repo"))
                run.Pr = args.Number("pr")
            }

            if run.Pr == 0 {
                throw CliFailure("invalid_state", "No PR has been published for this run")
            }

            let observation = ChecksObservation(run)

            while true {
                let gates = map[string, Object?]{}

                for name in[]string{"lifecycle", "receipt", "report", "checks", "dependencies", "freshness"} {
                    gates[name] = map[string, Object?]{"status": "unread"}
                }

                let facts = map[string, Object?]{
                    "gates": gates,
                    "machine_status": "pending",
                    "checks_status": "unread",
                    "owner_review": "unavailable",
                    "required_owner_actions": []string{"Inspect unavailable PR evidence before acceptance."},
                    "local_verification": "donor_reported_not_remotely_attested",
                    "owner_inspection_required": false,
                    "action_required_cause": "unknown"
                }
                let observed = List[Object]()
                observation.Stage = "lifecycle"
                observation.Approval = false
                observation.Failed = false
                observation.Pending = false

                try {
                    let result = Inspect(args, render, directory, observation, gates, facts, observed)

                    if result >= 0 {
                        return result
                    }
                } catch (error Exception) when error is CliFailure ||
                    error is ApiDeadlineException ||
                    error is IOException ||
                    error is UnauthorizedAccessException ||
                    error is JsonException ||
                    error.GetType() == typeof(Exception) {
                    FailedObservation(
                        error,
                        observation.Previous,
                        observation.Stage,
                        gates,
                        facts,
                        observed,
                        observation.Approval
                    )
                    let settling = error is CliFailure evidence && evidence.Code == "evidence_pending"

                    Show(
                        observation.Run,
                        observed,
                        facts,
                        directory,
                        args.Get("verbose") == "true",
                        observation.Approval,
                        render,
                        ref observation.Previous
                    )
                    if settling {
                        Output.Sink.Message(error.Message, "yellow")
                        return Output.PendingExitCode
                    }

                    if error is CliFailure || error is ApiDeadlineException {
                        throw error
                    }

                    throw CliFailure("command_failed", error.Message, summary: CliFailure.Message("command_failed"))
                }

                ApiTransport.PollWait("repos/" + observation.Run.Repo + "/commits/" + observation.Run.ChecksHead + "/")
            }
        }

        private func Inspect(
            args Args,
            render Action[Dictionary[string, Object?]],
            directory string,
            observation ChecksObservation,
            gates Dictionary[string, Object?],
            facts Dictionary[string, Object?],
            observed List[Object]
        ) int32 {
            ApiTransport.CheckDeadline()

            let pullPath = "repos/" + observation.Run.Repo + "/pulls/" + observation.Run.Pr.ToString()

            let pull = GitHub.Api(pullPath)

            CheckLifecycle(observation.Run, pull, facts, gates)

            let checkHead = CheckReceipt(observation, pull, facts, gates)

            if observation.Run.Incomplete {
                observation.Stage = "report"
                facts["incomplete"] = true
                throw CliFailure(
                    "invalid_state",
                    "Incomplete draft needs continued work and independent verification before readiness"
                )
            }

            observation.Stage = "freshness"
            let verifiedTarget = observation.Run.VerifiedTargetRevision
            facts["verified_target_revision"] = verifiedTarget

            observation.Stage = "report"
            let reportFailure = CheckReport(observation.Run, pull, gates)

            observation.Stage = "checks"

            var rows JsonElement
            try {
                rows = CommitChecks.Read(observation.Run.Repo, checkHead, observed)
            } catch (error Exception) when error.GetType() == typeof(Exception) &&
                (
                error.Message == "Cannot read complete commit checks" ||
                    error.Message == "Commit check inspection exceeded its bounded history"
            ) {
                throw CliFailure("command_failed", error.Message)
            }

            let awaiting = List[Object]()
            facts["workflow_runs_awaiting_approval"] = awaiting

            ReadApprovals(observation.Run, checkHead, awaiting, observation)

            let status = CheckRequired(
                observation.Run,
                checkHead,
                rows,
                facts,
                gates,
                observation.Approval,
                observation
            )

            CheckDependencies(observation, facts, gates)

            observation.Stage = "freshness"

            CheckFreshness(
                observation.Run,
                pullPath,
                checkHead,
                observation.Binding,
                observation.Identity,
                verifiedTarget,
                facts,
                gates
            )

            if reportFailure != "" && !observation.Pending {
                observation.Stage = "report"
                throw CliFailure("invalid_state", reportFailure)
            }

            facts["machine_status"] = status

            if reportFailure != "" {
                facts["required_owner_actions"] = observation.Approval ? []string{
                    ApprovalAction,
                    ReportAction,
                    Review(false)
                }:
                []string{ReportAction, Review(false)}
            }

            Show(
                observation.Run,
                observed,
                facts,
                directory,
                args.Get("verbose") == "true",
                observation.Approval,
                render,
                ref observation.Previous
            )

            if observation.Failed {
                return 1
            }

            if !observation.Pending {
                return 0
            }

            if args.Get("watch") != "true" || observation.Approval {
                return Output.PendingExitCode
            }

            return -1
        }

        private func CheckDependencies(
            observation ChecksObservation,
            facts Dictionary[string, Object?],
            gates Dictionary[string, Object?]
        ) {
            if !observation.Failed && !observation.Pending {
                observation.Stage = "dependencies"
                let dependencies = map[string, Object?]{}
                facts["dependency_evidence"] = dependencies

                Overlaps.DependencyEvidence(observation.Run.Repo, observation.Run.Issue, dependencies)

                let known = dependencies["dependencies_status"]?.ToString() == "complete"
                let passed = known && dependencies["dependency_gate"]?.ToString() == "no_open_dependencies"

                gates["dependencies"] = map[string, Object?]{
                    "status": passed ? "passed": (known ? "failed": "unavailable")
                }

                Overlaps.RequireDependencies(observation.Run.Repo, observation.Run.Issue, dependencies)
            }
        }

        private func CheckReceipt(
            observation ChecksObservation,
            pull JsonElement,
            facts Dictionary[string, Object?],
            gates Dictionary[string, Object?]
        ) string {
            if observation.Identity != "" && Identity(pull) != observation.Identity {
                observation.Stage = "freshness"
                throw CliFailure("stale_approval", "PR head, target, receipt or lifecycle changed while reading checks")
            }

            observation.Stage = "freshness"
            let branch = J.Text(J.Get(pull, "base"), "ref")
            let currentTarget = GitHub.Branch(observation.Run.Repo, branch)
            facts["target_branch"] = branch
            facts["target_revision"] = currentTarget

            observation.Stage = "receipt"

            observation.Run = ReceiptVerification.Verify(observation.Run.Repo, observation.Run.Pr, pull)
            let checkHead = J.Text(J.Get(pull, "head"), "sha")
            observation.Run.ChecksHead = checkHead
            facts["checks_head"] = checkHead
            let currentBinding = J.Write(J.Select(observation.Run.Element(), BindingFields))
            facts["binding"] = J.Select(observation.Run.Element(), BindingFields)
            gates["receipt"] = map[string, Object?]{"status": "passed"}

            observation.Stage = "freshness"

            if observation.Binding != "" && observation.Binding != currentBinding {
                throw CliFailure("stale_approval", "PR authority changed while reading checks")
            }

            observation.Binding = currentBinding
            observation.Identity = Identity(pull)
            return checkHead
        }

        private func CheckLifecycle(
            run Data,
            pull JsonElement,
            facts Dictionary[string, Object?],
            gates Dictionary[string, Object?]
        ) {
            facts["pr_observation"] = J.Select(pull, "state,draft,merged,merged_at,closed_at")
            facts["observed_head"] = J.Text(J.Get(pull, "head"), "sha")
            run.PrUrl = J.Text(pull, "html_url")
            let isOpen = J.Text(pull, "state") == "open" && !J.Bool(pull, "merged") &&
                (
                J.Get(pull, "merged_at").ValueKind == JsonValueKind.Undefined || J.Get(pull, "merged_at")
                    .ValueKind == JsonValueKind.Null
            )
            let historical = J.Text(pull, "state") == "closed" || J.Bool(pull, "merged") || J.Get(pull, "merged_at")
                .ValueKind == JsonValueKind.String
            facts["owner_review"] = isOpen ? "required": (historical ? "historical": "unavailable")
            facts["required_owner_actions"] = isOpen ? []string{Review(false)}: (
                historical ? []string{}: []string{"Inspect unavailable PR lifecycle evidence before acceptance."}
            )
            gates["lifecycle"] = map[string, Object?]{
                "status": isOpen ? "passed": (historical ? "historical": "unavailable")
            }

            if historical {
                throw CliFailure(
                    "invalid_state",
                    "PR #" + run.Pr.ToString() +
                        (
                        J.Bool(pull, "merged") || J.Get(pull, "merged_at").ValueKind == JsonValueKind.String ?
                        " was merged.": " was closed without merge."
                    ) +
                        " Machine gates were not evaluated."
                )
            }

            if !isOpen {
                throw CliFailure("invalid_state", "PR is not an open, unmerged contribution awaiting owner review")
            }
        }

        private func CheckReport(run Data, pull JsonElement, gates Dictionary[string, Object?]) string {
            var reportFailure string = ""

            try {
                PublicSummary.Current(
                    PrBody.ReportText(J.Text(pull, "body")),
                    run.PublicSummary,
                    run.Commit,
                    run.PublicReport
                )

                gates["report"] = map[string, Object?]{"status": "passed", "evidence": "complete"}
            } catch (error CliFailure) {
                reportFailure = error.Message
                gates["report"] = map[string, Object?]{"status": "failed", "reason": "missing_or_altered_public_report"}
            }
            return reportFailure
        }

        private func ReadApprovals(run Data, checkHead string, awaiting List[Object], observation ChecksObservation) {
            for page in 1 ... GitHub.PageCountLimit + 1 {
                let response = GitHub.Api(
                    "repos/" +
                        run.Repo +
                        "/actions/runs?head_sha=" +
                        checkHead +
                        "&status=action_required&" +
                        GitHub.PageSizeParameter +
                        "&page=" +
                        page.ToString()
                )

                let workflows = J.Get(response, "workflow_runs")

                if workflows.ValueKind != JsonValueKind.Array || workflows.GetArrayLength() > GitHub.PageSize {
                    throw CliFailure("command_failed", "Cannot read workflow runs awaiting approval")
                }

                for workflow in workflows.EnumerateArray() {
                    if J.Text(workflow, "head_sha") != checkHead || J.Text(
                        workflow,
                        "conclusion"
                    ) != "action_required" {
                        continue
                    }

                    observation.Approval = true

                    if awaiting.Count < Output.RowCountLimit {
                        awaiting.Add(J.Select(workflow, "id,name,head_sha,html_url,status,conclusion"))
                    } else {
                        Output.Sink.Truncated = true
                    }
                }

                if workflows.GetArrayLength() < GitHub.PageSize {
                    break
                }

                if page == GitHub.PageCountLimit {
                    throw CliFailure("command_failed", "Workflow approval inspection exceeded its bounded history")
                }
            }
        }

        private func CheckRequired(
            run Data,
            checkHead string,
            rows JsonElement,
            facts Dictionary[string, Object?],
            gates Dictionary[string, Object?],
            approval bool,
            observation ChecksObservation
        ) string {
            var missing bool
            var inspection bool

            for row in J.Items(rows) {
                inspection = inspection || J.Text(row, "state") == "ACTION_REQUIRED"
            }

            let required = List[Object]()
            let names = J.Items(Policy.Parse(run.Policy).RequiredChecks)

            for name in names {
                var found bool
                var passed bool = true
                var conflicting bool
                var success bool
                var nameFailed bool

                for row in J.Items(rows) {
                    if J.Text(row, "name") == name.GetString() {
                        found = true
                        success = success || J.Text(row, "bucket") == "pass"
                        passed = passed && J.Text(row, "bucket") == "pass"
                        nameFailed = nameFailed || J.Text(row, "bucket") == "fail" || J.Text(row, "bucket") == "cancel"
                    }
                }

                conflicting = success && !passed
                observation.Failed = observation.Failed || nameFailed
                observation.Pending = observation.Pending || !found || !passed
                missing = missing || !found

                if required.Count < Output.RowCountLimit {
                    required.Add(
                        map[string, Object?]{
                            "name": name,
                            "status": !found ? "missing": (
                                conflicting ? "conflicting": (passed ? "passed": (nameFailed ? "failed": "pending"))
                            )
                        }
                    )
                } else {
                    Output.Sink.Truncated = true
                }
            }

            let status = observation.Failed ? "failed": (observation.Pending ? "pending": "passed")
            facts["checks_status"] = status
            facts["required_checks"] = required
            facts["required_check_count"] = names.Count
            facts["owner_inspection_required"] = inspection || approval

            facts["required_owner_actions"] = []string{Review(status == "passed")}

            if inspection || approval {
                facts["required_owner_actions"] = []string{
                    approval ? ApprovalAction: UnknownApprovalAction,
                    Review(status == "passed")
                }
            }

            if missing && !approval {
                let workflows = J.Get(
                    GitHub.Api("repos/" + run.Repo + "/actions/runs?head_sha=" + checkHead + "&per_page=1"),
                    "workflow_runs"
                )

                if workflows.ValueKind != JsonValueKind.Array {
                    throw CliFailure("command_failed", "Cannot read workflow runs for this head")
                }

                if workflows.GetArrayLength() == 0 {
                    facts[
                        "ci_hint"
                    ] = "GitHub has not started CI for this head yet. Use tokate checks --watch to wait for CI."
                }
            }

            gates["checks"] = map[string, Object?]{"status": status, "evidence": "complete"}
            return status
        }

        private func CheckFreshness(
            run Data,
            pullPath string,
            checkHead string,
            binding string,
            identity string,
            verifiedTarget string,
            facts Dictionary[string, Object?],
            gates Dictionary[string, Object?]
        ) {
            let livePull = GitHub.Api(pullPath)

            ObserveAfter(livePull, facts)
            if J.Text(J.Get(livePull, "head"), "sha") != checkHead {
                throw CliFailure("stale_approval", "PR head, target, receipt or lifecycle changed while reading checks")
            }

            let live = ReceiptVerification.Verify(run.Repo, run.Pr, livePull)

            facts["binding_after"] = J.Select(live.Element(), BindingFields)

            if J.Write(J.Select(live.Element(), BindingFields)) != binding {
                throw CliFailure("stale_approval", "PR authority changed while reading checks")
            }

            let finalPull = GitHub.Api(pullPath)

            ObserveAfter(finalPull, facts)

            if Identity(livePull) != identity || Identity(finalPull) != identity {
                throw CliFailure("stale_approval", "PR head, target, receipt or lifecycle changed while reading checks")
            }

            let liveTarget = GitHub.Branch(run.Repo, run.BaseBranch)

            facts["target_revision_after"] = liveTarget
            facts["target_moved"] = liveTarget != verifiedTarget
            facts["mergeable"] = J.Get(finalPull, "mergeable")
                .ValueKind == JsonValueKind.True ? true: (
                J.Get(finalPull, "mergeable").ValueKind == JsonValueKind.False ? false as Object: nil
            )
            facts["mergeable_state"] = J.Text(finalPull, "mergeable_state")
            let reconcile = J.Get(finalPull, "mergeable").ValueKind == JsonValueKind.False || J.Text(
                finalPull,
                "mergeable_state"
            ) == "behind"
            facts["target_merge_required"] = reconcile

            if reconcile {
                facts[
                    "target_merge_next"
                ] = "Merge the target branch into the saved checkout. Resolve conflicts, then run tokate amend with an explicit verification budget."
            }

            ApiTransport.CheckDeadline()
            gates["freshness"] = map[string, Object?]{"status": "passed"}
        }

        private func FailedObservation(
            error Exception,
            previous string,
            stage string,
            gates Dictionary[string, Object?],
            facts Dictionary[string, Object?],
            observed List[Object],
            approval bool
        ) {
            if previous != "" {
                facts["previous_observation"] = map[string, Object?]{
                    "current": false,
                    "result": J.Get(J.Parse(previous), "result")
                }
            }

            let timedOut = error is ApiDeadlineException deadline
            let settling = error is CliFailure evidence && evidence.Code == "evidence_pending"
            let unavailable = timedOut ||
                error is CliFailure transport &&
                (transport.Code == "command_failed" || transport.Code == "authentication_required")
            let stale = error is CliFailure failure &&
                failure.Code == "stale_approval" ||
                stage == "freshness" &&
                !unavailable
            let gate = gates[stage] as Dictionary[string, Object?] ?? throw Exception("Invalid check gate")

            if gate["status"]?.ToString() == "unread" || stage == "freshness" {
                gate["status"] = settling ? "pending": (
                    stale ? "stale": (unavailable || stage == "checks" ? "unavailable": "failed")
                )
            }

            gate["reason"] = settling ? "evidence_pending": (
                timedOut ? "deadline": (stale ? "changed_authority_or_identity": "evidence_blocked_or_unavailable")
            )

            if stage == "freshness" || stale {
                Invalidate(gates, facts)
            }

            facts["machine_status"] = timedOut || settling ? "pending": "failed"

            if stage == "checks" {
                facts["checks_status"] = stale ? "stale": "unavailable"
                gate["evidence"] = stale ? "stale": (observed.Count > 0 ? "incomplete": "unavailable")
            }

            if facts["owner_review"]?.ToString() == "required" {
                let action = settling ? error.Message: (
                    stage == "dependencies" ? "Inspect native dependencies; every dependency must be closed as completed before machine success.": (
                        stage == "checks" ? "Inspect incomplete or unavailable exact-head CI evidence before acceptance.": (
                            stage == "report" ? ReportAction:
                            "Inspect current approval, receipt, protected paths, PR head, target and lifecycle evidence before acceptance."
                        )
                    )
                )

                facts["required_owner_actions"] = []string{action, Review(false)}

                for row in observed {
                    if J.Text(J.Parse(J.Write(row)), "state") == "ACTION_REQUIRED" {
                        facts["owner_inspection_required"] = true
                        facts["required_owner_actions"] = []string{UnknownApprovalAction, action, Review(false)}

                        break
                    }
                }

                if approval {
                    facts["owner_inspection_required"] = true
                    facts["required_owner_actions"] = []string{ApprovalAction, action, Review(false)}
                }
            }
        }
    }
}
