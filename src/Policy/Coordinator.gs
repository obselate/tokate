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
            let action = CoordinatorRequest.Parse(request).Action
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
            let declaration = RequestMetadata.Request(request)

            let state = CoordinationState.Load(repo, number)
            let binding = RequestMetadata.Binding(RepositoryIdentity.PositiveId(actor), request)
            let outcomes = state.Outcomes

            for old in outcomes {
                if old.Uuid == declaration.Uuid {
                    if old.Binding != binding {
                        throw Exception("UUID replay changed actor or request contents")
                    }

                    return Replay(repo, number, state, request, actor, donor, old.Outcome)
                }
            }

            if state.Sha != declaration.Expected || state.ApprovalId != declaration.Approval {
                throw CliFailure("stale_approval", "Stale state or approval; evicted requests cannot repeat effects")
            }

            let action = declaration.Action
            let record = action == "release" ? JsonElement{}: state.Check(repo, number, donor, actor)
            var outcome CoordinationState.ResultRecord
            let originalExpiry = state.Lease?.Expires ?? 0

            if action == "claim" || LeaseLifecycle.Transition(action) {
                outcome = LeaseLifecycle.Apply(state, request, actor, donor, J.Get(record, "policy"))
            } else if action == "amend" {
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

            retained.Add(CoordinationState.ReplayRecord{Uuid: declaration.Uuid, Binding: binding, Outcome: outcome})
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
            let declaration = CoordinatorRequest.Parse(request)
            let metadata = declaration.Metadata
            let publication = PublicationRequestMetadata.Parse(metadata)
            LeaseLifecycle.Fence(state, publication.Attempt)

            if state.Contribution != nil {
                throw Exception("Contribution already published; use the recorded outcome or fresh owner approval")
            }

            let handoff = ContributionHandoff.Declaration(publication.Handoff)
            ContributionHandoff.Authority(state, handoff)
            ContributionHandoff.Candidate(handoff, publication.Fork, publication.Head)
            AttemptContinuation.Declaration(publication)

            if publication.Predecessor.ValueKind != JsonValueKind.Undefined {
                AttemptContinuation.Authority(state, publication.Predecessor)
            }

            Policy(J.Write(J.Get(record, "policy"))).ValidateTools(publication.Tools, publication.SourceKind)

            let correction = publication.Correction
            if correction.ValueKind != JsonValueKind.Undefined {
                RequestMetadata.Correction(correction, publication.Head, J.Get(record, "policy"))
            }

            RepositoryAccess.ValidateFork(
                repo,
                publication.Fork,
                publication.Branch,
                publication.Head,
                RepositoryIdentity.PositiveId(actor)
            )
            ValidateDiff(repo, record, metadata)

            let reservation = state.Lease?.Reservation ?? ""
            if publication.Branch != "tokate/v2-" + reservation {
                throw Exception("Publication must use this reservation's branch")
            }

            let receipt = ContributionReceipt.Publication(repo, number, request, reservation, donor)
            RepositoryIdentity.PositiveId(publication.PrValue)
            Revalidate(repo, number, state, actor, donor)
            RepositoryAccess.ValidateFork(
                repo,
                publication.Fork,
                publication.Branch,
                publication.Head,
                RepositoryIdentity.PositiveId(actor)
            )
            let pull = PublicationPull(repo, metadata, actor, record)
            let body = PrBody.Coordinated(record, metadata, donor, receipt, "<!-- tokate-v2:" + reservation + " -->")
            let title = (publication.Incomplete ? "Incomplete: ": "") + J.Text(J.Get(record, "issue"), "title")

            if J.Text(pull, "body") != body || J.Text(pull, "title") != title {
                Revalidate(repo, number, state, actor, donor)
                GitHub.Api(
                    "repos/" + repo + "/pulls/" + publication.Pr.ToString(),
                    map[string, Object?]{"body": body, "title": title},
                    "PATCH",
                    expires: state.Lease?.Expires ?? 0
                )
            }

            Revalidate(repo, number, state, actor, donor)
            RepositoryAccess.ValidateFork(
                repo,
                publication.Fork,
                publication.Branch,
                publication.Head,
                RepositoryIdentity.PositiveId(actor)
            )

            let outcome = CoordinationState
                .ResultRecord{
                Pr: J.Number(pull, "number"),
                PrJson: J.Get(pull, "number"),
                Url: J.Text(pull, "html_url"),
                Head: publication.Head,
                Reservation: reservation
            }

            state.Contribution = CoordinationState
                .PublicationRecord{
                Request: declaration.Uuid,
                Expected: declaration.Expected,
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
            let publication = PublicationRequestMetadata.Parse(metadata)
            let pull = GitHub.Api("repos/" + repo + "/pulls/" + publication.Pr.ToString())
            let head = J.Get(pull, "head")
            let target = J.Get(pull, "base")

            if J.Get(J.Get(pull, "user"), "id").ToString() != actor.ToString() {
                throw Exception("Publication PR author differs from reserved donor")
            }

            if !RepositoryIdentity.SameRepo(J.Text(J.Get(head, "repo"), "full_name"), publication.Fork) || J.Text(
                head,
                "ref"
            ) != publication.Branch {
                throw Exception("Publication PR head repository or branch differs from reservation")
            }

            if J.Text(head, "sha") != publication.Head {
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

            if !RepositoryIdentity.SameRepo(publication.Fork, repo) && J.Get(pull, "maintainer_can_modify").ValueKind !=
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
            let declaration = CoordinatorRequest.Parse(request)
            let action = declaration.Action
            let updated = action == "release" ? state.Lease?.Value() ?? default(JsonElement): default(JsonElement)

            if action == "amend" {
                Revalidate(repo, number, state, actor, donor)
                GitHubPathEvidence.Amendment(repo, record, AmendmentRequestMetadata.Parse(declaration.Metadata))
            }

            let live = CoordinationState.Load(repo, number)
            if live.Sha != state.Sha {
                let recorded = RequestMetadata.Recorded(live, RepositoryIdentity.PositiveId(actor), request)
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
                    declaration.Expected,
                    LeaseLifecycle.Transition(action) ? originalExpiry: state.Lease?.Expires ?? 0
                )
            } catch (error Exception) {
                let inspected = CoordinationState.Load(repo, number)
                let recorded = RequestMetadata.Recorded(inspected, RepositoryIdentity.PositiveId(actor), request)
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
                let recorded = RequestMetadata.Recorded(acquired, RepositoryIdentity.PositiveId(actor), request)
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

            if action == "amend" {
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
            state.Reservation(actor)
            let declaration = CoordinatorRequest.Parse(request)
            let metadata = declaration.Metadata
            let amendmentMetadata = AmendmentRequestMetadata.Parse(metadata)
            ValidateAmendment(repo, state, record, amendmentMetadata, actor)
            let current = state.Current()
            let old = state.Contribution?.Metadata ?? default(JsonElement)
            let reservation = state.Lease
            let prepared = PrepareAmendment(repo, record, reservation, declaration, amendmentMetadata)
            let run = prepared.Item1
            let amendment = prepared.Item2

            let receipt = Amendment.Receipt(
                ContributionReceipt.FromState(state),
                amendment,
                amendmentMetadata.Head,
                declaration.Expected
            )
            let pull = Amendment.Pull(run, amendmentMetadata.Pr, amendmentMetadata.Head, "")
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
                GitHubPathEvidence.Amendment(repo, record, amendmentMetadata)
                RepositoryAccess.ValidateFork(
                    repo,
                    amendmentMetadata.Fork,
                    amendmentMetadata.Branch,
                    amendmentMetadata.Head,
                    RepositoryIdentity.PositiveId(actor)
                )

                let fresh = Amendment.Pull(run, amendmentMetadata.Pr, amendmentMetadata.Head, "")
                if J.Text(fresh, "body") != body {
                    throw Exception("PR body changed before amendment write")
                }

                AccessState.Check(repo, number, J.Get(record, "approval"), actor, J.Get(record, "policy"))
                let changes = map[string, Object?]{"body": updated}
                let title = J.Text(J.Get(record, "issue"), "title")
                let originalMetadata = PublicationRequestMetadata.Parse(old)
                if RequestMetadata.Incomplete(originalMetadata.HasIncomplete, originalMetadata.Incomplete) && J.Text(
                    fresh,
                    "title"
                ) == "Incomplete: " +
                    title {
                    changes["title"] = title
                }

                GitHub.Api(
                    "repos/" + repo + "/pulls/" + amendmentMetadata.Pr.ToString(),
                    changes,
                    "PATCH",
                    expires: reservation?.Expires ?? 0
                )
            }

            Revalidate(repo, number, state, actor, donor)
            GitHubPathEvidence.Amendment(repo, record, amendmentMetadata)
            RepositoryAccess.ValidateFork(
                repo,
                amendmentMetadata.Fork,
                amendmentMetadata.Branch,
                amendmentMetadata.Head,
                RepositoryIdentity.PositiveId(actor)
            )

            let latest = Amendment.Pull(run, amendmentMetadata.Pr, amendmentMetadata.Head, "")
            if RequestData.Canonical(PrBody.Receipt(J.Text(latest, "body")).ToJson()) != candidateCanonical ||
                PrBody.ReportText(J.Text(latest, "body")) != report {
                throw Exception("Physical PR receipt changed; amendment has no coordination authority")
            }

            return RecordAmendment(state, declaration, amendmentMetadata, actor, donor, run, latest, retainedHistory)
        }

        private func PrepareAmendment(
            repo string,
            record JsonElement,
            reservation CoordinationState.LeaseRecord?,
            declaration CoordinatorRequest,
            amendmentMetadata AmendmentRequestMetadata
        ) ValueTuple[Data, Data] {
            let branch = amendmentMetadata.Branch

            let run = Data{
                Version: 2,
                Repo: repo,
                Id: reservation?.Reservation ?? "",
                HeadRepo: amendmentMetadata.Fork,
                Branch: branch,
                BaseBranch: OwnerApproval.Record.Parse(J.Get(record, "approval")).BaseBranch
            }

            let amendment = Data{
                Id: declaration.Uuid,
                Previous: amendmentMetadata.Previous,
                Seconds: amendmentMetadata.Seconds,
                Tools: amendmentMetadata.Tools
            }

            if amendmentMetadata.Summary.ValueKind != JsonValueKind.Undefined {
                amendment.PublicSummary = amendmentMetadata.Summary
            }

            if amendmentMetadata.Base != "" {
                amendment.Base = amendmentMetadata.Base
            }

            return (run, amendment)
        }

        private func ValidateAmendment(
            repo string,
            state CoordinationState,
            record JsonElement,
            amendmentMetadata AmendmentRequestMetadata,
            actor JsonElement
        ) {
            LeaseLifecycle.Fence(state, amendmentMetadata.Attempt)
            let original = state.Contribution
            let current = state.Current()
            let old = original?.Metadata ?? default(JsonElement)
            let policy = Policy(J.Write(J.Get(record, "policy")))
            Amendment.Tools(policy, amendmentMetadata.Tools)
            let reservation = state.Lease
            let branch = amendmentMetadata.Branch
            let failure = "Amendment differs from current published contribution authority"
            let originalActor = (original?.ActorValue() ?? default(JsonElement)).ToString()

            if amendmentMetadata.Seconds > policy.MaxSeconds || originalActor != actor.ToString() {
                throw Exception(failure)
            }

            let publishedPr = current?.Outcome.Pr ?? 0
            let publishedHead = state.Head()
            if amendmentMetadata.Previous != publishedHead || amendmentMetadata.Pr != publishedPr {
                throw Exception(failure)
            }

            let originalMetadata = PublicationRequestMetadata.Parse(old)
            if !RepositoryIdentity.SameRepo(amendmentMetadata.Fork, originalMetadata.Fork) {
                throw Exception(failure)
            }

            let expectedBranch = "tokate/v2-" + (reservation?.Reservation ?? "")
            if branch != originalMetadata.Branch || branch != expectedBranch {
                throw Exception(failure)
            }

            RepositoryAccess.ValidateFork(
                repo,
                amendmentMetadata.Fork,
                amendmentMetadata.Branch,
                amendmentMetadata.Head,
                RepositoryIdentity.PositiveId(actor)
            )
            GitHubPathEvidence.Amendment(repo, record, amendmentMetadata)
        }

        private func RecordAmendment(
            state CoordinationState,
            declaration CoordinatorRequest,
            amendmentMetadata AmendmentRequestMetadata,
            actor JsonElement,
            donor string,
            run Data,
            latest JsonElement,
            retainedHistory List[CoordinationState.PublicationRecord]
        ) CoordinationState
            .ResultRecord {
            let outcome = CoordinationState
                .ResultRecord{
                Pr: amendmentMetadata.Pr,
                PrJson: amendmentMetadata.PrValue,
                Url: J.Text(latest, "html_url"),
                Head: amendmentMetadata.Head,
                Reservation: run.Id
            }

            let entry = CoordinationState
                .PublicationRecord{
                Request: declaration.Uuid,
                Expected: declaration.Expected,
                Previous: amendmentMetadata.Previous,
                Head: amendmentMetadata.Head,
                Seconds: amendmentMetadata.Seconds,
                Tools: amendmentMetadata.Tools,
                Actor: actor.GetInt64(),
                ActorJson: actor,
                Donor: donor,
                Attempt: state.Lease?.Attempt ?? "",
                Outcome: outcome,
                IsAmendment: true,
                Summary: amendmentMetadata.Summary,
                Base: amendmentMetadata.Base,
                HasBase: amendmentMetadata.Base != ""
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
            let publication = PublicationRequestMetadata.Parse(metadata)
            GitHubPathEvidence.Check(
                repo,
                J.Get(record, "policy"),
                J.Get(record, "approval"),
                J.Text(record, "base"),
                publication.Fork,
                publication.Head
            )
        }
    }
}
