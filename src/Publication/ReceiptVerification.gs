package Tokate

import System
import System.Text.Json

internal class ReceiptVerification {
    shared {
        internal func Verify(repo string, number int32, paths bool = true) Data -> Verify(
            repo,
            number,
            GitHub.Api("repos/" + repo + "/pulls/" + number.ToString()),
            paths
        )

        internal func Verify(repo string, number int32, pull JsonElement, paths bool = true) Data {
            let body = J.Text(pull, "body")
            let receipt = ContributionReceipt.Record.Parse(
                RequestData.Parse(PrBody.ReceiptText(body, "PR needs exactly one Tokate receipt"), 1024 * 1024)
            )

            if receipt.Version != 2 {
                throw CliFailure("invalid_state", "Unsupported receipt protocol")
            }

            return VerifyCurrent(repo, number, pull, receipt, paths)
        }

        internal func Binding(
            run Data,
            receipt ContributionReceipt.Record,
            approval JsonElement,
            revision string,
            base string
        ) {
            run.Fields["version"] = receipt.Version
            run.Fields["issue"] = receipt.Issue
            run.Fields["approval"] = receipt.Approval
            run.Fields["donor"] = receipt.Donor
            run.Fields["expected"] = receipt.Expected
            run.Fields["reservation"] = receipt.Reservation
            if receipt.Incomplete.ValueKind != JsonValueKind.Undefined {
                run.Fields["incomplete"] = receipt.Incomplete
            }
            if receipt.RequestedModel.ValueKind != JsonValueKind.Undefined {
                run.Fields["requested_model"] = receipt.RequestedModel
            }
            if receipt.ReportedModel.ValueKind != JsonValueKind.Undefined {
                run.Fields["reported_model"] = receipt.ReportedModel
            }

            let approved = OwnerApproval.Record.Parse(approval)
            run.Fields["base"] = base
            run.Fields["base_branch"] = approved.BaseBranch

            run.Fields["authority_revision"] = revision
            run.Fields["receipt_hash"] = J.Hash(RequestData.Canonical(receipt.ToJson()))
            run.Fields["policy_hash"] = approved.PolicyHash
        }

        internal func VerifyCurrent(
            repo string,
            number int32,
            pull JsonElement,
            receipt ContributionReceipt.Record,
            paths bool = true
        ) Data {
            RequestData.Keys(
                receipt.ToJson(),
                "version,repo,issue,approval,expected,reservation,donor,head,correction,amendment,predecessor,import_manifest_sha256,attempt,incomplete,handoff,requested_model,reported_model"
            )

            let state = CoordinationState.Load(repo, receipt.Issue)
            let value = state.Value()
            let contribution = J.Get(value, "contribution")

            VerifyPendingPublication(repo, number, pull, receipt, state, value, contribution)

            let metadata = J.Get(contribution, "metadata")
            let handoff = J.Get(metadata, "handoff")

            ContributionHandoff.Declaration(handoff)

            if !RequestData.Same(receipt.Handoff, handoff) {
                throw CliFailure("stale_approval", "Receipt handoff differs from the authoritative source")
            }

            ContributionHandoff.Authority(state, handoff)

            let current = CoordinationState.Current(value)
            let incomplete = current.GetRawText() == contribution.GetRawText() && RequestMetadata.Incomplete(metadata)

            if receipt.Incomplete.ValueKind != (incomplete ? JsonValueKind.True: JsonValueKind.Undefined) {
                throw CliFailure("stale_approval", "Receipt completion state differs from the current contribution")
            }

            let outcome = J.Get(current, "outcome")
            let exactHead = J.Text(outcome, "head")

            if paths {
                ContributionHandoff.Candidate(handoff, J.Text(metadata, "fork"), exactHead)
            }

            let donor = RepositoryIdentity.Login(receipt.Donor)
            let record = state.Check(repo, receipt.Issue, donor, J.Get(contribution, "actor"))
            let publicationRevision = J.Text(value, "publication_revision")
            let authenticated = publicationRevision == "" ? state: CoordinationState.At(
                repo,
                receipt.Issue,
                publicationRevision
            )

            VerifyPublicationAuthority(repo, receipt, value, contribution, current, authenticated)

            let policy = VerifyContributionIdentity(
                repo,
                number,
                pull,
                receipt,
                value,
                contribution,
                metadata,
                outcome,
                exactHead,
                donor,
                record
            )

            VerifyContinuation(receipt, metadata, authenticated, pull)

            let amendment = VerifyAmendment(receipt, current, contribution, policy, exactHead, metadata, pull)

            return CompleteVerification(
                repo,
                number,
                pull,
                record,
                exactHead,
                current,
                metadata,
                contribution,
                receipt,
                state,
                value,
                amendment,
                paths
            )
        }

        private func VerifyPendingPublication(
            repo string,
            number int32,
            pull JsonElement,
            receipt ContributionReceipt.Record,
            state CoordinationState,
            value JsonElement,
            contribution JsonElement
        ) {
            if contribution.ValueKind != JsonValueKind.Object && J.Text(value, "approval_id") == receipt.Approval &&
                state.Sha == receipt.Expected &&
                RepositoryIdentity
                .SameRepo(receipt.Repo, repo) {
                let reservation = J.Get(value, "reservation")
                if J.Text(reservation, "reservation") == receipt.Reservation && J.Text(
                    J.Get(pull, "head"),
                    "sha"
                ) == receipt
                    .Head {
                    state.Check(repo, receipt.Issue, receipt.Donor, J.Get(reservation, "actor"))
                    LeaseLifecycle.Owner(state, J.Get(reservation, "actor"), active: true)
                    throw CliFailure(
                        "evidence_pending",
                        "PR publication is awaiting coordinator adoption. Wait, then run tokate checks " +
                            repo +
                            "#" +
                            number.ToString() + " again."
                    )
                }
            }

            if J.Text(value, "approval_id") != receipt.Approval || contribution.ValueKind != JsonValueKind.Object {
                throw CliFailure("stale_approval", "PR approval or contribution no longer matches")
            }
        }

        private func VerifyPublicationAuthority(
            repo string,
            receipt ContributionReceipt.Record,
            value JsonElement,
            contribution JsonElement,
            current JsonElement,
            authenticated CoordinationState
        ) {
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
            let expected = receipt.Expected

            if parents.Count != 1 || J.Text(parents[0], "sha") != expected || J.Text(current, "expected") != expected {
                throw CliFailure("stale_approval", "Receipt does not match the authoritative contribution revision")
            }
        }

        private func VerifyContributionIdentity(
            repo string,
            number int32,
            pull JsonElement,
            receipt ContributionReceipt.Record,
            value JsonElement,
            contribution JsonElement,
            metadata JsonElement,
            outcome JsonElement,
            exactHead string,
            donor string,
            record JsonElement
        ) Policy {
            let approval = J.Get(record, "approval")
            let reservation = J.Get(value, "reservation")
            let head = J.Get(pull, "head")
            let headRepo = J.Get(head, "repo")
            let base = J.Get(pull, "base")
            let approvalId = J.Text(value, "approval_id")
            let reservationId = J.Text(reservation, "reservation")
            let branch = J.Text(metadata, "branch")
            let fork = J.Text(metadata, "fork")
            let target = OwnerApproval.Record.Parse(approval).BaseBranch
            let failure = "PR receipt lacks current exact-commit coordination authority"
            let receiptApproval = receipt.Approval
            let receiptReservation = receipt.Reservation

            if !RepositoryIdentity.SameRepo(receipt.Repo, repo) {
                throw CliFailure("stale_approval", failure)
            }

            if receiptApproval != approvalId || receiptReservation != reservationId {
                throw CliFailure("stale_approval", failure)
            }

            let policy = Policy(J.Write(J.Get(record, "policy")))
            let receiptHead = receipt.Head
            let physicalHead = J.Text(head, "sha")

            if J.Number(outcome, "pr") != number || receiptHead != exactHead {
                throw CliFailure("stale_approval", failure)
            }

            if physicalHead != exactHead {
                try {
                    GitHubPathEvidence.CleanMerges(repo, fork, approval, exactHead, physicalHead)
                } catch (error Exception) when error.GetType() == typeof(Exception) {
                    throw CliFailure("stale_approval", failure + ". " + error.Message)
                }
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

            return policy
        }

        private func VerifyContinuation(
            receipt ContributionReceipt.Record,
            metadata JsonElement,
            authenticated CoordinationState,
            pull JsonElement
        ) {
            let attempt = receipt.Attempt.ValueKind == JsonValueKind.String ? receipt.Attempt.GetString() ?? "": ""

            if !RequestData.Same(receipt.Predecessor, J.Get(metadata, "predecessor")) || !RequestData.Same(
                receipt.ImportManifestSha256,
                J.Get(metadata, "import_manifest_sha256")
            ) ||
                !RequestData.Same(receipt.RequestedModel, J.Get(metadata, "requested_model")) || !RequestData.Same(
                receipt.ReportedModel,
                J.Get(metadata, "reported_model")
            ) {
                throw CliFailure("stale_approval", "Continuation receipt differs from authoritative import provenance")
            }

            let prior = J.Get(metadata, "predecessor")

            if prior.ValueKind != JsonValueKind.Undefined {
                if attempt != J.Text(metadata, "attempt") {
                    throw CliFailure("stale_approval", "Continuation receipt lost its destination attempt fence")
                }

                AttemptContinuation.Authority(authenticated, prior)

                if !PrBody.ReportText(J.Text(pull, "body")).Contains(PrBody.ContinuationReport(prior).Trim()) {
                    throw CliFailure("invalid_state", "PR report omitted interrupted-origin provenance")
                }
            } else if receipt.Attempt.ValueKind != JsonValueKind.Undefined {
                throw CliFailure("stale_approval", "Receipt claims continuation authority without predecessor evidence")
            }
        }

        private func VerifyAmendment(
            receipt ContributionReceipt.Record,
            current JsonElement,
            contribution JsonElement,
            policy Policy,
            exactHead string,
            metadata JsonElement,
            pull JsonElement
        ) JsonElement {
            let amendment = receipt.Amendment

            if current.GetRawText() != contribution.GetRawText() {
                Amendment.ValidateReceipt(amendment, policy, exactHead)

                let reportData = J.Select(amendment, "previous,seconds")
                reportData["head"] = exactHead
                reportData["tools"] = J.Get(amendment, "tools")
                PublicSummary.Attach(reportData, J.Get(current, "summary"))
                let report = PrBody.PublicReport(J.Parse(J.Write(reportData)), metadata)

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

            return amendment
        }

        private func CompleteVerification(
            repo string,
            number int32,
            pull JsonElement,
            record JsonElement,
            exactHead string,
            current JsonElement,
            metadata JsonElement,
            contribution JsonElement,
            receipt ContributionReceipt.Record,
            state CoordinationState,
            value JsonElement,
            amendment JsonElement,
            paths bool
        ) Data {
            let reservation = J.Get(value, "reservation")
            let approval = J.Get(record, "approval")
            let fork = J.Text(metadata, "fork")

            let baseline = J.Text(amendment, "base") == "" ? J.Text(reservation, "base"): J.Text(amendment, "base")

            if J.Text(amendment, "base") != J.Text(current, "base") {
                throw CliFailure("stale_approval", "Amendment base differs from coordination authority")
            }

            if baseline != J.Text(reservation, "base") {
                GitHubPathEvidence.Target(repo, approval, baseline)
                GitHubPathEvidence.Ancestor(repo, baseline, fork, exactHead)
            }

            let correction = receipt.Correction

            if !RequestData.Same(correction, J.Get(metadata, "correction")) {
                throw CliFailure("stale_approval", "Correction receipt differs from authoritative publication metadata")
            }

            if correction.ValueKind != JsonValueKind.Undefined {
                RequestMetadata.Correction(correction, J.Text(metadata, "head"), J.Get(record, "policy"))
            }

            if paths {
                GitHubPathEvidence.Check(
                    repo,
                    J.Get(record, "policy"),
                    approval,
                    baseline,
                    J.Text(metadata, "fork"),
                    exactHead
                )
            }

            AccessState.Check(repo, receipt.Issue, approval, J.Get(contribution, "actor"), J.Get(record, "policy"))

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
                run.Fields["public_report"] = PrBody.PublicReport(metadata).Trim()
            }

            if authority.ValueKind != JsonValueKind.Undefined {
                run.Fields["public_summary"] = authority
            }

            ReceiptVerification.Binding(run, receipt, approval, state.Sha, J.Text(reservation, "base"))
            run.Fields["verified_target_revision"] = baseline

            return run
        }
    }
}
