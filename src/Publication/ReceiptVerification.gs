package Tokate

import System
import System.Text.Json

internal class ReceiptVerification {
    shared {
        internal func Verify(repo string, number int32, ready bool = true, paths bool = true) Data -> Verify(
            repo,
            number,
            GitHub.Api("repos/" + repo + "/pulls/" + number.ToString()),
            ready,
            paths
        )

        internal func Verify(
            repo string,
            number int32,
            pull JsonElement,
            ready bool = true,
            paths bool = true,
            pending string = ""
        ) Data {
            let body = J.Text(pull, "body")
            let receipt = RequestData.Parse(
                PrBody.ReceiptText(body, "PR needs exactly one Tokate receipt"),
                1024 * 1024
            )

            if J.Number(receipt, "version") != 2 {
                throw CliFailure("invalid_state", "Unsupported receipt protocol")
            }

            return VerifyCurrent(repo, number, pull, receipt, ready, paths, pending)
        }

        internal func Binding(run Data, receipt JsonElement, approval JsonElement, revision string) {
            for key in[]string{"version", "issue", "approval", "donor", "expected", "reservation", "incomplete"} {
                if J.Get(receipt, key).ValueKind != JsonValueKind.Undefined {
                    run.Fields[key] = J.Get(receipt, key)
                }
            }

            for key in[]string{"base", "base_branch"} {
                run.Fields[key] = J.Get(approval, key)
            }

            run.Fields["authority_revision"] = revision
            run.Fields["receipt_hash"] = Data.Hash(RequestData.Canonical(receipt))
            run.Fields["policy_hash"] = J.Get(approval, "policy_hash")
        }

        internal func VerifyCurrent(
            repo string,
            number int32,
            pull JsonElement,
            receipt JsonElement,
            ready bool = true,
            paths bool = true,
            pending string = ""
        ) Data {
            RequestData.Keys(
                receipt,
                "version,repo,issue,approval,expected,reservation,donor,head,correction,amendment,synchronizations,predecessor,import_manifest_sha256,attempt,incomplete,handoff"
            )

            let state = CoordinationState.Load(repo, J.Number(receipt, "issue"))
            let value = state.Value()
            let contribution = J.Get(value, "contribution")

            if J.Text(value, "approval_id") != J.Text(receipt, "approval") ||
                contribution.ValueKind != JsonValueKind.Object {
                throw CliFailure("stale_approval", "PR approval or contribution no longer matches")
            }

            let metadata = J.Get(contribution, "metadata")
            let handoff = J.Get(metadata, "handoff")

            ContributionHandoff.Declaration(handoff)

            if !RequestData.Same(J.Get(receipt, "handoff"), handoff) {
                throw CliFailure("stale_approval", "Receipt handoff differs from the authoritative source")
            }

            ContributionHandoff.Authority(state, handoff)

            let current = CoordinationState.Current(value)
            let incomplete = current.GetRawText() == contribution.GetRawText() && RequestData.Incomplete(metadata)

            if J.Get(receipt, "incomplete").ValueKind != (incomplete ? JsonValueKind.True: JsonValueKind.Undefined) {
                throw CliFailure("stale_approval", "Receipt completion state differs from the current contribution")
            }

            let outcome = J.Get(current, "outcome")
            let exactHead = J.Text(outcome, "head")

            if paths {
                ContributionHandoff.Candidate(handoff, J.Text(metadata, "fork"), exactHead)
            }

            let donor = RepositoryIdentity.Login(J.Text(receipt, "donor"))
            var record JsonElement
            try {
                record = state.Check(repo, J.Number(receipt, "issue"), donor, J.Get(contribution, "actor"))
            } catch (error Exception) when error.GetType() == typeof(Exception) &&
                error.Message == "Choose an open issue" {
                throw CliFailure("invalid_state", error.Message)
            }
            let publicationRevision = J.Text(value, "publication_revision")
            let authenticated = publicationRevision == "" ? state: CoordinationState.At(
                repo,
                J.Number(receipt, "issue"),
                publicationRevision
            )

            if !RequestData.Same(J.Get(authenticated.Value(), "contribution"), contribution) || !RequestData.Same(
                CoordinationState.Current(authenticated.Value()),
                current
            ) ||
                J.Text(authenticated.Value(), "approval_id") != J.Text(value, "approval_id") || !RequestData.Same(
                J.Get(authenticated.Value(), "identity"),
                J.Get(value, "identity")
            ) {
                throw CliFailure("stale_approval", "Publication revision differs from current contribution evidence")
            }

            let publishedLease = J.Get(authenticated.Value(), "reservation")
            let publishedIdentity = J.Get(authenticated.Value(), "identity")

            if J.Text(publishedLease, "status") != "active" || J.Text(publishedLease, "attempt") == "" || J.Text(
                publishedIdentity,
                "id"
            ) != J.Text(publishedLease, "reservation") || RepositoryIdentity.PositiveId(
                J.Get(publishedIdentity, "actor")
            ) != RepositoryIdentity.PositiveId(J.Get(contribution, "actor")) || RepositoryIdentity.PositiveId(
                J.Get(publishedLease, "actor")
            ) != RepositoryIdentity
                .PositiveId(J.Get(contribution, "actor")) {
                throw CliFailure("stale_approval", "Publication revision lacks authenticated active attempt authority")
            }

            LeaseLifecycle.Fence(
                authenticated,
                J.Get(current, "metadata").ValueKind == JsonValueKind.Object ? J.Text(
                    J.Get(current, "metadata"),
                    "attempt"
                ): J.Text(current, "attempt")
            )

            let stateCommit = GitHub.Api("repos/" + repo + "/git/commits/" + authenticated.Sha)
            let parents = J.Items(J.Get(stateCommit, "parents"))
            let expected = J.Text(receipt, "expected")

            if parents.Count != 1 || J.Text(parents[0], "sha") != expected || J.Text(current, "expected") != expected {
                throw CliFailure("stale_approval", "Receipt does not match the authoritative contribution revision")
            }

            let approval = J.Get(record, "approval")
            let reservation = J.Get(value, "reservation")
            let head = J.Get(pull, "head")
            let headRepo = J.Get(head, "repo")
            let base = J.Get(pull, "base")
            let approvalId = J.Text(value, "approval_id")
            let reservationId = J.Text(reservation, "reservation")
            let branch = J.Text(metadata, "branch")
            let fork = J.Text(metadata, "fork")
            let target = J.Text(approval, "base_branch")
            let failure = "PR receipt lacks current exact-commit coordination authority"
            let receiptApproval = J.Text(receipt, "approval")
            let receiptReservation = J.Text(receipt, "reservation")

            if !RepositoryIdentity.SameRepo(J.Text(receipt, "repo"), repo) {
                throw CliFailure("stale_approval", failure)
            }

            if receiptApproval != approvalId || receiptReservation != reservationId {
                throw CliFailure("stale_approval", failure)
            }

            let policy = Policy(J.Write(J.Get(record, "policy")))
            let receiptHead = J.Text(receipt, "head")
            let physicalHead = J.Text(head, "sha")

            if J.Number(outcome, "pr") != number || receiptHead != exactHead {
                throw CliFailure("stale_approval", failure)
            }

            if physicalHead != exactHead {
                let grant = pending == "" ? default(JsonElement): Synchronization.Load(repo, pending)

                if J.Text(grant, "previous") != exactHead || J.Text(grant, "candidate") != physicalHead || J.Text(
                    grant,
                    "expected"
                ) != state.Sha ||
                    !RequestData.Same(J.Get(grant, "receipt"), receipt) || GitHub.Branch(repo, target) == J.Text(
                    grant,
                    "upstream"
                ) {
                    throw CliFailure("stale_approval", failure)
                }

                let history = Synchronization.Append(repo, Synchronization.History(receipt), pending)

                Synchronization.Live(
                    repo,
                    number,
                    record,
                    approvalId,
                    history,
                    fork,
                    branch,
                    physicalHead,
                    pending,
                    state.Sha,
                    exactHead,
                    ready: false,
                    contribution: contribution
                )

                Synchronization.Remote(
                    repo,
                    policy.Value,
                    approval,
                    J.Text(approval, "base"),
                    history,
                    fork,
                    physicalHead
                )
            }

            if J.Text(head, "ref") != branch || !RepositoryIdentity.SameRepo(J.Text(headRepo, "full_name"), fork) {
                throw CliFailure("stale_approval", failure)
            }

            if J.Text(base, "ref") != target {
                throw CliFailure("stale_approval", failure)
            }

            if donor != J.Text(contribution, "donor") {
                throw CliFailure("stale_approval", "Receipt donor differs from the canonical contribution actor")
            }

            RepositoryAccess.ValidateFork(
                repo,
                J.Parse(
                    J.Write(
                        map[string, Object?]{
                            "fork": J.Text(metadata, "fork"),
                            "branch": J.Text(metadata, "branch"),
                            "head": physicalHead
                        }
                    )
                ),
                J.Get(contribution, "actor")
            )

            policy.ValidateTools(J.Get(metadata, "tools"), J.Text(metadata, "source"))
            AttemptContinuation.Declaration(metadata)

            for key in[]string{"predecessor", "import_manifest_sha256"} {
                if !RequestData.Same(J.Get(receipt, key), J.Get(metadata, key)) {
                    throw CliFailure(
                        "stale_approval",
                        "Continuation receipt differs from authoritative import provenance"
                    )
                }
            }

            let prior = J.Get(metadata, "predecessor")

            if prior.ValueKind != JsonValueKind.Undefined {
                if J.Text(receipt, "attempt") != J.Text(metadata, "attempt") {
                    throw CliFailure("stale_approval", "Continuation receipt lost its destination attempt fence")
                }

                AttemptContinuation.Authority(authenticated, prior)

                if !PrBody.ReportText(J.Text(pull, "body")).Contains(PrBody.ContinuationReport(prior).Trim()) {
                    throw CliFailure("invalid_state", "PR report omitted interrupted-origin provenance")
                }
            } else if J.Get(receipt, "attempt").ValueKind != JsonValueKind.Undefined {
                throw CliFailure("stale_approval", "Receipt claims continuation authority without predecessor evidence")
            }

            let amendment = J.Get(receipt, "amendment")

            if current.GetRawText() != contribution.GetRawText() {
                Amendment.ValidateReceipt(amendment, policy, exactHead)

                let report = Amendment.Summary(
                    J.Text(amendment, "previous"),
                    exactHead,
                    J.Number(amendment, "seconds"),
                    J.Get(amendment, "tools"),
                    J.Get(current, "summary"),
                    metadata
                )

                if !RequestData.Same(J.Get(amendment, "summary"), J.Get(current, "summary")) {
                    throw CliFailure("stale_approval", "PR amendment summary differs from coordination authority")
                }

                let observedReport = PrBody.ReportText(J.Text(pull, "body"))

                if observedReport != report {
                    throw CliFailure("stale_approval", "PR amendment report differs from coordination authority")
                }

                let failure = "Amendment receipt differs from current coordination record"

                if J.Text(amendment, "id") != J.Text(current, "request") || J.Text(amendment, "previous") != J.Text(
                    current,
                    "previous"
                ) ||
                    J.Number(amendment, "seconds") != J.Number(current, "seconds") {
                    throw CliFailure("stale_approval", failure)
                }

                if RequestData.Canonical(J.Get(amendment, "tools")) != RequestData.Canonical(J.Get(current, "tools")) {
                    throw CliFailure("stale_approval", failure)
                }
            } else if amendment.ValueKind != JsonValueKind.Undefined {
                throw CliFailure("stale_approval", "Receipt claims an amendment without coordination authority")
            }

            let history = Synchronization.History(receipt)
            let synchronizationFailure = "Synchronization receipt differs from authoritative coordination history"

            if J.Text(amendment, "sync") != J.Text(current, "sync") {
                throw CliFailure("stale_approval", synchronizationFailure)
            }

            if RequestData.Canonical(history) != RequestData.Canonical(Synchronization.History(current)) {
                throw CliFailure("stale_approval", synchronizationFailure)
            }

            let correction = J.Get(receipt, "correction")

            if !RequestData.Same(correction, J.Get(metadata, "correction")) {
                throw CliFailure("stale_approval", "Correction receipt differs from authoritative publication metadata")
            }

            if correction.ValueKind != JsonValueKind.Undefined {
                RequestData.Correction(correction, J.Text(metadata, "head"), J.Get(record, "policy"))
            }

            Synchronization.Live(
                repo,
                number,
                record,
                J.Text(value, "approval_id"),
                history,
                J.Text(metadata, "fork"),
                J.Text(metadata, "branch"),
                exactHead,
                ready: ready,
                contribution: contribution,
                current: false
            )

            if paths && history.GetArrayLength() > 0 {
                Synchronization.Remote(
                    repo,
                    policy.Value,
                    approval,
                    J.Text(approval, "base"),
                    history,
                    J.Text(metadata, "fork"),
                    exactHead
                )
            } else if paths {
                GitHubPathEvidence.Check(
                    repo,
                    J.Get(record, "policy"),
                    approval,
                    J.Text(approval, "base"),
                    J.Text(metadata, "fork"),
                    exactHead
                )
            }

            if history.GetArrayLength() > 0 {
                let live = CoordinationState.Load(repo, J.Number(receipt, "issue"))

                if live.Sha != state.Sha {
                    throw CliFailure("stale_approval", "Coordination authority changed during receipt validation")
                }

                live.Check(repo, J.Number(receipt, "issue"), donor, J.Get(contribution, "actor"))

                Synchronization.Live(
                    repo,
                    number,
                    record,
                    J.Text(value, "approval_id"),
                    history,
                    J.Text(metadata, "fork"),
                    J.Text(metadata, "branch"),
                    exactHead,
                    ready: ready,
                    contribution: contribution,
                    current: false
                )
            }

            AccessState.Check(
                repo,
                J.Number(receipt, "issue"),
                approval,
                J.Get(contribution, "actor"),
                J.Get(record, "policy")
            )

            let run = Data()

            run.Fields["version"] = 2
            run.Fields["repo"] = repo
            run.Fields["pr"] = number
            run.Fields["commit"] = exactHead
            run.Fields["pr_url"] = J.Text(pull, "html_url")
            run.Fields["policy"] = J.Get(record, "policy")
            let authority = J.Get(current, "summary").ValueKind == JsonValueKind.Undefined ?
            J.Get(metadata, "summary"): J.Get(current, "summary")

            if current.GetRawText() == contribution.GetRawText() {
                run.Fields["public_report"] = PrBody.CoordinatedReport(metadata).Trim()
            }

            if authority.ValueKind != JsonValueKind.Undefined {
                run.Fields["public_summary"] = authority
            }

            ReceiptVerification.Binding(run, receipt, approval, state.Sha)
            Synchronization.Keep(run.Fields, history)

            return run
        }
    }
}
