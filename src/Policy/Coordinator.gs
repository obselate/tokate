package Tokate

import System
import System.Collections.Generic
import System.Text.Json
import System.Text.RegularExpressions

internal class Coordinator {
    shared {
        private func ApproveLabel(repo string, event JsonElement) {
            let eventIssue = J.Get(event, "issue")
            let eventRepository = J.Get(event, "repository")

            if J.Text(event, "action") != "labeled" || J.Text(J.Get(event, "label"), "name") != "tokate:approved" ||
                J
                .Get(eventIssue, "pull_request").ValueKind != JsonValueKind.Undefined {
                throw Exception("Expected an issues labeled tokate:approved event for an issue")
            }

            if !RepositoryIdentity.SameRepo(J.Text(eventRepository, "full_name"), repo) {
                throw Exception("Event repository does not match coordinator repository")
            }

            let info = GitHub.Api("repos/" + repo)
            let number = J.Number(eventIssue, "number")
            if number < 1 || RepositoryIdentity.PositiveId(J.Get(eventRepository, "id")) !=
            RepositoryIdentity.PositiveId(J.Get(info, "id")) {
                throw Exception("Label event repository or issue identity changed")
            }

            let issue = GitHub.Api("repos/" + repo + "/issues/" + number.ToString())
            if J.Number(issue, "number") != number || RepositoryIdentity.PositiveId(J.Get(eventIssue, "id")) !=
            RepositoryIdentity.PositiveId(J.Get(issue, "id")) || J.Get(issue, "pull_request")
                .ValueKind != JsonValueKind.Undefined {
                throw Exception("Label event issue identity changed")
            }

            if !GitHub.HasLabel(issue) {
                Output.Sink.Message("Approval label is no longer present.")
                return
            }

            let sender = J.Get(event, "sender")
            let actor = RepositoryIdentity.PositiveId(J.Get(sender, "id"))
            let login = RepositoryIdentity.Login(J.Text(sender, "login"))
            let permission = GitHub.Api("repos/" + repo + "/collaborators/" + login + "/permission")
            let user = J.Get(permission, "user")
            if RepositoryIdentity.PositiveId(J.Get(user, "id")) != actor || !String.Equals(
                J.Text(user, "login"),
                login,
                StringComparison.OrdinalIgnoreCase
            ) {
                throw Exception("Label sender identity changed")
            }

            let level = J.Text(permission, "permission")
            if level != "write" && level != "maintain" && level != "admin" {
                GitHub.Api(
                    "repos/" + repo + "/issues/" + number.ToString() + "/labels/tokate%3Aapproved",
                    method: "DELETE"
                )
                GitHub.Api(
                    "repos/" + repo + "/issues/" + number.ToString() + "/comments",
                    map[string, Object?]{
                        "body": "The tokate:approved label was removed. Approval requires repository write, maintain or admin permission."
                    }
                )
                Output.Sink.Message("Approval label removed because the sender lacks repository write permission.")
                return
            }

            if J.Text(issue, "state") != "open" {
                throw Exception("Choose an open issue")
            }

            let args = Args([]string{"approve", repo + "#" + number.ToString(), "--non-interactive"})
            let state = CoordinationState.Load(repo, number, true)
            let previous = state.Approval
            let active = previous != nil && !state.Revoked ? previous: nil
            if active != nil {
                args.Values["--base-branch"] = active.BaseBranch
            }
            let approval = OwnerApproval.Capture(args, info, issue)
            if active != nil {
                approval.AllowedActorIds = active.AllowedActorIds
            }
            if active != nil &&
                approval.PolicyHash == active.PolicyHash &&
                approval.TemplateHash == active.TemplateHash &&
                approval.IssueHash == active.IssueHash {
                Output.Sink.Message("Issue approval is already current.")
                return
            }

            approval.Nonce = Guid.NewGuid().ToString("N")
            CoordinationState.Approve(repo, number, approval)
            Output.Sink.Message("Issue approved from the tokate:approved label.")
        }

        internal func Run(args Args) ValueTuple[JsonElement, string] {
            let repo = RepositoryIdentity.Repo(args.Need("repo"))
            let event = RequestData.FileData(args.Need("event"), 1024 * 1024)
            if Environment.GetEnvironmentVariable("GITHUB_EVENT_NAME") == "issues" {
                ApproveLabel(repo, event)
                return ValueTuple[JsonElement, string](JsonElement{}, "")
            }

            return Process(repo, event, Environment.GetEnvironmentVariable("GITHUB_EVENT_NAME") ?? "")
        }

        private func Replay(
            repo string,
            number int32,
            state CoordinationState,
            request JsonElement,
            actor JsonElement,
            donor string,
            outcome CoordinationState.ResultRecord
        ) ValueTuple[JsonElement, string] {
            let action = J.Text(request, "action")
            if action != "release" {
                state.Check(repo, number, donor, actor)
            }
            if action == "amend" {
                ReceiptVerification.Verify(repo, outcome.Pr)
            }
            if action == "publish" {
                ContributionHandoff.Supersede(state, request)
            }
            return ValueTuple[JsonElement, string](outcome.Value(), "Recorded request outcome")
        }

        private func Process(repo string, event JsonElement, eventName string) ValueTuple[JsonElement, string] {
            let eventComment = J.Get(event, "comment")
            let eventIssue = J.Get(event, "issue")
            let eventRepository = J.Get(event, "repository")
            let failure = "Expected a created issue_comment /tokate request"

            if eventName != "issue_comment" || J.Text(event, "action") != "created" {
                throw Exception(failure)
            }

            if !J.Text(eventComment, "body").StartsWith("/tokate ", StringComparison.Ordinal) || J.Get(
                eventIssue,
                "pull_request"
            )
                .ValueKind != JsonValueKind.Undefined {
                throw Exception(failure)
            }

            if !RepositoryIdentity.SameRepo(J.Text(eventRepository, "full_name"), repo) {
                throw Exception("Event repository does not match coordinator repository")
            }

            let number = J.Number(eventIssue, "number")
            let commentId = RepositoryIdentity.PositiveId(J.Get(eventComment, "id"))

            let canonical = GitHub.Api("repos/" + repo + "/issues/comments/" + commentId.ToString())
            let canonicalUser = J.Get(canonical, "user")
            let actor = J.Get(canonicalUser, "id")
            RepositoryIdentity.PositiveId(actor)
            let donor = RepositoryIdentity.Login(J.Text(canonicalUser, "login"))

            let info = GitHub.Api("repos/" + repo)
            let eventActor = J.Get(J.Get(eventComment, "user"), "id")
            let identityFailure = "Comment author, content, repository or issue identity changed"
            let eventRepositoryId = J.Get(eventRepository, "id").ToString()
            let repositoryId = J.Get(info, "id").ToString()
            let canonicalId = J.Get(canonical, "id").ToString()

            if number < 1 || eventRepositoryId != repositoryId || canonicalId != commentId.ToString() {
                throw Exception(identityFailure)
            }

            if !RepositoryIdentity.IsIssueUrl(J.Text(canonical, "issue_url"), repo, number) {
                throw Exception(identityFailure)
            }

            if actor.ToString() != eventActor.ToString() || J.Text(canonical, "body") != J.Text(eventComment, "body") {
                throw Exception(identityFailure)
            }

            let text = J.Text(canonical, "body")
            if !text.StartsWith("/tokate ", StringComparison.Ordinal) {
                throw Exception("Canonical comment is not a request")
            }

            let request = RequestMetadata.CommentData(text)
            RequestMetadata.Request(request)

            let state = CoordinationState.Load(repo, number)
            let binding = RequestMetadata.Binding(actor, request)
            let outcomes = state.Outcomes

            for old in outcomes {
                if old.Uuid == J.Text(request, "uuid") {
                    if old.Binding != binding {
                        throw Exception("UUID replay changed actor or request contents")
                    }

                    return Replay(repo, number, state, request, actor, donor, old.Outcome)
                }
            }

            if state.Sha != J.Text(request, "expected") || state.ApprovalId != J.Text(request, "approval") {
                throw CliFailure("stale_approval", "Stale state or approval; evicted requests cannot repeat effects")
            }

            let action = J.Text(request, "action")
            let record = action == "release" ? JsonElement{}: state.Check(repo, number, donor, actor)
            var outcome CoordinationState.ResultRecord
            let originalExpiry = state.Lease?.Expires ?? 0

            if action == "claim" || LeaseLifecycle.Transition(action) {
                outcome = LeaseLifecycle.Apply(state, request, actor, donor, J.Get(record, "policy"))
            } else if J.Text(request, "action") == "amend" {
                outcome = Amend(repo, number, state, record, request, actor, donor)
            } else {
                outcome = Publish(repo, number, state, record, request, actor, donor)
            }

            if action == "publish" || action == "amend" {
                state.PublicationRevision = ""
                state.Include("publication_revision")
            }

            let retained = List[CoordinationState.ReplayRecord]()

            for i in Math.Max(0, outcomes.Count - 31) ... outcomes.Count {
                retained.Add(outcomes[i])
            }

            retained.Add(
                CoordinationState.ReplayRecord{Uuid: J.Text(request, "uuid"), Binding: binding, Outcome: outcome}
            )
            state.Outcomes = retained
            state.Include("outcomes")

            return CommitRequest(repo, number, state, record, request, actor, donor, outcome, originalExpiry)
        }

        private func Publish(
            repo string,
            number int32,
            state CoordinationState,
            record JsonElement,
            request JsonElement,
            actor JsonElement,
            donor string
        ) CoordinationState
            .ResultRecord {
            state.Reservation(actor)
            LeaseLifecycle.Fence(state, J.Text(J.Get(request, "metadata"), "attempt"))

            if state.Contribution != nil {
                throw Exception("Contribution already published; use the recorded outcome or fresh owner approval")
            }

            let metadata = J.Get(request, "metadata")
            ContributionHandoff.Authority(state, J.Get(metadata, "handoff"))
            ContributionHandoff.Candidate(
                J.Get(metadata, "handoff"),
                J.Text(metadata, "fork"),
                J.Text(metadata, "head")
            )
            AttemptContinuation.Declaration(metadata)

            if J.Get(metadata, "predecessor").ValueKind != JsonValueKind.Undefined {
                AttemptContinuation.Authority(state, J.Get(metadata, "predecessor"))
            }

            Policy(J.Write(J.Get(record, "policy"))).ValidateTools(J.Get(metadata, "tools"), J.Text(metadata, "source"))

            let correction = J.Get(metadata, "correction")
            if correction.ValueKind != JsonValueKind.Undefined {
                RequestMetadata.Correction(correction, J.Text(metadata, "head"), J.Get(record, "policy"))
            }

            RepositoryAccess.ValidateFork(repo, metadata, actor)
            ValidateDiff(repo, record, metadata)

            let reservation = state.Lease?.Reservation ?? ""
            if J.Text(metadata, "branch") != "tokate/v2-" + reservation {
                throw Exception("Publication must use this reservation's branch")
            }

            let receipt = ContributionReceipt.Publication(repo, number, request, reservation, donor)
            RepositoryIdentity.PositiveId(J.Get(metadata, "pr"))
            Revalidate(repo, number, state, actor, donor)
            RepositoryAccess.ValidateFork(repo, metadata, actor)
            let pull = PublicationPull(repo, metadata, actor, record)
            let body = PrBody.Coordinated(record, metadata, donor, receipt, "<!-- tokate-v2:" + reservation + " -->")
            let title = (RequestMetadata.Incomplete(metadata) ? "Incomplete: ": "") + J.Text(
                J.Get(record, "issue"),
                "title"
            )

            if J.Text(pull, "body") != body || J.Text(pull, "title") != title {
                Revalidate(repo, number, state, actor, donor)
                GitHub.Api(
                    "repos/" + repo + "/pulls/" + J.Number(metadata, "pr").ToString(),
                    map[string, Object?]{"body": body, "title": title},
                    "PATCH",
                    expires: state.Lease?.Expires ?? 0
                )
            }

            Revalidate(repo, number, state, actor, donor)
            RepositoryAccess.ValidateFork(repo, metadata, actor)

            let outcome = CoordinationState
                .ResultRecord{
                Pr: J.Number(pull, "number"),
                PrJson: J.Get(pull, "number"),
                Url: J.Text(pull, "html_url"),
                Head: J.Text(metadata, "head"),
                Reservation: reservation
            }

            state.Contribution = CoordinationState
                .PublicationRecord{
                Request: J.Text(request, "uuid"),
                Expected: J.Text(request, "expected"),
                Metadata: metadata,
                Actor: actor.GetInt64(),
                ActorJson: actor,
                Donor: donor,
                Outcome: outcome
            }
            state.Include("contribution")

            return outcome
        }

        private func PublicationPull(
            repo string,
            metadata JsonElement,
            actor JsonElement,
            record JsonElement
        ) JsonElement {
            let pull = GitHub.Api("repos/" + repo + "/pulls/" + J.Number(metadata, "pr").ToString())
            let head = J.Get(pull, "head")
            let target = J.Get(pull, "base")

            if J.Get(J.Get(pull, "user"), "id").ToString() != actor.ToString() {
                throw Exception("Publication PR author differs from reserved donor")
            }

            if !RepositoryIdentity.SameRepo(J.Text(J.Get(head, "repo"), "full_name"), J.Text(metadata, "fork")) ||
                J.Text(head, "ref") != J.Text(metadata, "branch") {
                throw Exception("Publication PR head repository or branch differs from reservation")
            }

            if J.Text(head, "sha") != J.Text(metadata, "head") {
                throw Exception("Publication PR head SHA differs from receipt")
            }

            if !RepositoryIdentity.SameRepo(J.Text(J.Get(target, "repo"), "full_name"), repo) || J.Text(
                target,
                "ref"
            ) != OwnerApproval
                .Record
                .Parse(J.Get(record, "approval"))
                .BaseBranch {
                throw Exception("Publication PR base differs from reserved target")
            }

            if J.Text(pull, "state") != "open" || !J.Bool(pull, "draft") || J.Bool(pull, "merged") {
                throw Exception("Publication PR must be an open draft")
            }

            if !RepositoryIdentity.SameRepo(J.Text(metadata, "fork"), repo) && J.Get(pull, "maintainer_can_modify")
                .ValueKind !=
            (Policy(J.Write(J.Get(record, "policy"))).MaintainerEdits ? JsonValueKind.True: JsonValueKind.False) {
                throw Exception("Publication PR maintainer edits differ from policy")
            }

            return pull
        }

        private func CommitRequest(
            repo string,
            number int32,
            state CoordinationState,
            record JsonElement,
            request JsonElement,
            actor JsonElement,
            donor string,
            outcome CoordinationState.ResultRecord,
            originalExpiry int64
        ) ValueTuple[JsonElement, string] {
            let action = J.Text(request, "action")
            let updated = action == "release" ? state.Lease?.Value() ?? default(JsonElement): default(JsonElement)

            if action == "amend" {
                Revalidate(repo, number, state, actor, donor)
                GitHubPathEvidence.Amendment(repo, record, J.Get(request, "metadata"))
            }

            let live = CoordinationState.Load(repo, number)
            if live.Sha != state.Sha {
                let recorded = RequestMetadata.Recorded(live, actor, request)
                if recorded != nil {
                    return Replay(repo, number, live, request, actor, donor, recorded)
                }
                throw CliFailure("stale_approval", "Coordination changed before reservation update")
            }
            let previous = live.Sha

            if LeaseLifecycle.Transition(action) {
                LeaseLifecycle.Owner(live, actor)
            }

            if (action == "claim" || LeaseLifecycle.Transition(action)) && action != "release" {
                live.Check(repo, number, donor, actor)
            } else if action != "release" {
                AccessState.Check(
                    repo,
                    number,
                    live.Approval?.Value() ?? default(JsonElement),
                    actor,
                    J.Get(record, "policy")
                )
            }

            try {
                state.Write(
                    repo,
                    number,
                    J.Text(request, "expected"),
                    LeaseLifecycle.Transition(action) ? originalExpiry: state.Lease?.Expires ?? 0
                )
            } catch (error Exception) {
                let inspected = CoordinationState.Load(repo, number)
                let recorded = RequestMetadata.Recorded(inspected, actor, request)
                if recorded != nil {
                    return Replay(repo, number, inspected, request, actor, donor, recorded)
                }

                throw Exception(
                    error.Message +
                        "\nPR and coordination writes are not atomic. A physical PR may lack valid authority; inspect verify and redeliver the same saved UUID request only after reading current state.",
                    error
                )
            }

            var acquired = CoordinationState.Load(repo, number)
            for attempt in 0 ... 5 {
                if acquired.Sha != previous {
                    break
                }

                ApiTransport.Settle()
                acquired = CoordinationState.Load(repo, number)
            }

            if acquired.Sha != state.Sha {
                let recorded = RequestMetadata.Recorded(acquired, actor, request)
                if recorded != nil {
                    return Replay(repo, number, acquired, request, actor, donor, recorded)
                }
                throw CliFailure(
                    "stale_approval",
                    "Coordination changed after reservation update; inspect current state"
                )
            }

            if action == "release" {
                if !RequestData.Same(acquired.Lease?.Value() ?? default(JsonElement), updated) ||
                    (acquired.Lease?.Status ?? "") != "released" {
                    throw Exception("Release outcome differs from recorded ownership evidence")
                }
            } else {
                acquired.Check(repo, number, donor, actor)
                LeaseLifecycle.Owner(acquired, actor)
            }

            if J.Text(request, "action") == "amend" {
                ReceiptVerification.Verify(repo, outcome.Pr)
            }

            if action == "publish" {
                ContributionHandoff.Supersede(acquired, request)
            }

            return ValueTuple[JsonElement, string](outcome.Value(), "Request outcome")
        }

        private func Amend(
            repo string,
            number int32,
            state CoordinationState,
            record JsonElement,
            request JsonElement,
            actor JsonElement,
            donor string
        ) CoordinationState
            .ResultRecord {
            ValidateAmendment(repo, state, record, request, actor)
            let current = state.Current()
            let metadata = J.Get(request, "metadata")
            let old = state.Contribution?.Metadata ?? default(JsonElement)
            let reservation = state.Lease
            let branch = J.Text(metadata, "branch")

            let run = Data()
            run.Fields["version"] = 2
            run.Fields["repo"] = repo
            run.Fields["id"] = reservation?.Reservation ?? ""
            run.Fields["head_repo"] = J.Text(metadata, "fork")
            run.Fields["branch"] = branch
            run.Fields["base_branch"] = OwnerApproval.Record.Parse(J.Get(record, "approval")).BaseBranch

            let amendment = Data()
            amendment.Fields["id"] = J.Text(request, "uuid")
            amendment.Fields["previous"] = J.Text(metadata, "previous")
            amendment.Fields["seconds"] = J.Number(metadata, "seconds")
            amendment.Fields["tools"] = J.Get(metadata, "tools")

            if J.Get(metadata, "summary").ValueKind != JsonValueKind.Undefined {
                amendment.Fields["public_summary"] = J.Get(metadata, "summary")
            }

            if J.Text(metadata, "base") != "" {
                amendment.Fields["base"] = J.Text(metadata, "base")
            }

            let receipt = Amendment.Receipt(
                ContributionReceipt.FromState(state),
                amendment,
                J.Text(metadata, "head"),
                J.Text(request, "expected")
            )
            let pull = Amendment.Pull(run, J.Number(metadata, "pr"), J.Text(metadata, "head"), "")
            let body = J.Text(pull, "body")
            let oldReceipt = PrBody.Receipt(body)
            let report = PrBody.PublicReport(metadata, old)

            let retainedHistory = List[CoordinationState.PublicationRecord]()

            for prior in state.Amendments {
                retainedHistory.Add(prior)
            }

            let oldCanonical = RequestData.Canonical(oldReceipt.ToJson())
            let candidateCanonical = RequestData.Canonical(receipt)

            if oldCanonical == candidateCanonical {
                let observedReport = PrBody.ReportText(body)
                if observedReport != report {
                    throw Exception("Candidate PR report differs from saved amendment intent")
                }
            }

            if oldCanonical != candidateCanonical {
                if oldCanonical != RequestData.Canonical(ContributionReceipt.FromState(state)) {
                    throw Exception("PR receipt differs from saved previous or candidate state")
                }

                let previousReport = retainedHistory.Count == 0 ? PrBody.PublicReport(old):
                PrBody.PublicReport(current ?? throw Exception("Missing coordination amendment"), old)
                let observedReport = PrBody.ReportText(body)

                if observedReport != previousReport {
                    throw Exception("Previous PR report differs from current contribution")
                }

                let updated = PrBody.ReplaceBody(body, report, receipt)
                Revalidate(repo, number, state, actor, donor)
                GitHubPathEvidence.Amendment(repo, record, metadata)
                RepositoryAccess.ValidateFork(repo, metadata, actor)

                let fresh = Amendment.Pull(run, J.Number(metadata, "pr"), J.Text(metadata, "head"), "")
                if J.Text(fresh, "body") != body {
                    throw Exception("PR body changed before amendment write")
                }

                AccessState.Check(repo, number, J.Get(record, "approval"), actor, J.Get(record, "policy"))
                let changes = map[string, Object?]{"body": updated}
                let title = J.Text(J.Get(record, "issue"), "title")
                if RequestMetadata.Incomplete(old) && J.Text(fresh, "title") == "Incomplete: " + title {
                    changes["title"] = title
                }

                GitHub.Api(
                    "repos/" + repo + "/pulls/" + J.Number(metadata, "pr").ToString(),
                    changes,
                    "PATCH",
                    expires: reservation?.Expires ?? 0
                )
            }

            Revalidate(repo, number, state, actor, donor)
            GitHubPathEvidence.Amendment(repo, record, metadata)
            RepositoryAccess.ValidateFork(repo, metadata, actor)

            let latest = Amendment.Pull(run, J.Number(metadata, "pr"), J.Text(metadata, "head"), "")
            if RequestData.Canonical(PrBody.Receipt(J.Text(latest, "body")).ToJson()) != candidateCanonical ||
                PrBody.ReportText(J.Text(latest, "body")) != report {
                throw Exception("Physical PR receipt changed; amendment has no coordination authority")
            }

            return RecordAmendment(state, request, actor, donor, run, latest, retainedHistory)
        }

        private func ValidateAmendment(
            repo string,
            state CoordinationState,
            record JsonElement,
            request JsonElement,
            actor JsonElement
        ) {
            state.Reservation(actor)
            LeaseLifecycle.Fence(state, J.Text(J.Get(request, "metadata"), "attempt"))
            let original = state.Contribution
            let current = state.Current()
            let metadata = J.Get(request, "metadata")
            let old = original?.Metadata ?? default(JsonElement)
            let policy = Policy(J.Write(J.Get(record, "policy")))
            Amendment.Tools(policy, J.Get(metadata, "tools"))
            let reservation = state.Lease
            let branch = J.Text(metadata, "branch")
            let failure = "Amendment differs from current published contribution authority"
            let originalActor = (original?.ActorValue() ?? default(JsonElement)).ToString()

            if J.Number(metadata, "seconds") > policy.MaxSeconds || originalActor != actor.ToString() {
                throw Exception(failure)
            }

            let publishedPr = current?.Outcome.Pr ?? 0
            let publishedHead = state.Head()
            if J.Text(metadata, "previous") != publishedHead || J.Number(metadata, "pr") != publishedPr {
                throw Exception(failure)
            }

            if !RepositoryIdentity.SameRepo(J.Text(metadata, "fork"), J.Text(old, "fork")) {
                throw Exception(failure)
            }

            let expectedBranch = "tokate/v2-" + (reservation?.Reservation ?? "")
            if branch != J.Text(old, "branch") || branch != expectedBranch {
                throw Exception(failure)
            }

            RepositoryAccess.ValidateFork(repo, metadata, actor)
            GitHubPathEvidence.Amendment(repo, record, metadata)
        }

        private func RecordAmendment(
            state CoordinationState,
            request JsonElement,
            actor JsonElement,
            donor string,
            run Data,
            latest JsonElement,
            retainedHistory List[CoordinationState.PublicationRecord]
        ) CoordinationState
            .ResultRecord {
            let metadata = J.Get(request, "metadata")
            let outcome = CoordinationState
                .ResultRecord{
                Pr: J.Number(metadata, "pr"),
                PrJson: J.Get(metadata, "pr"),
                Url: J.Text(latest, "html_url"),
                Head: J.Text(metadata, "head"),
                Reservation: run.Text("id")
            }

            let entry = CoordinationState
                .PublicationRecord{
                Request: J.Text(request, "uuid"),
                Expected: J.Text(request, "expected"),
                Previous: J.Text(metadata, "previous"),
                Head: J.Text(metadata, "head"),
                Seconds: J.Number(metadata, "seconds"),
                Tools: J.Get(metadata, "tools"),
                Actor: actor.GetInt64(),
                ActorJson: actor,
                Donor: donor,
                Attempt: state.Lease?.Attempt ?? "",
                Outcome: outcome,
                IsAmendment: true,
                Summary: J.Get(metadata, "summary"),
                Base: J.Text(metadata, "base"),
                HasBase: J.Text(metadata, "base") != ""
            }

            retainedHistory.Add(entry)
            state.Amendments = retainedHistory
            state.Include("amendments")

            return outcome
        }

        private func Revalidate(repo string, issue int32, state CoordinationState, actor JsonElement, donor string) {
            let live = CoordinationState.Load(repo, issue)

            if live.Sha != state.Sha {
                throw CliFailure("stale_approval", "Coordination revision changed during publication")
            }

            live.Check(repo, issue, donor, actor)
            live.Reservation(actor)
        }

        private func ValidateDiff(repo string, record JsonElement, metadata JsonElement) {
            GitHubPathEvidence.Check(
                repo,
                J.Get(record, "policy"),
                J.Get(record, "approval"),
                J.Text(record, "base"),
                J.Text(metadata, "fork"),
                J.Text(metadata, "head")
            )
        }
    }
}
