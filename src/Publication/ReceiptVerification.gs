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
            let contribution = state.Contribution

            VerifyPendingPublication(repo, number, pull, receipt, state, contribution)

            let metadata = contribution?.Metadata ?? default(JsonElement)
            let handoff = J.Get(metadata, "handoff")

            ContributionHandoff.Declaration(handoff)

            if !RequestData.Same(receipt.Handoff, handoff) {
                throw CliFailure("stale_approval", "Receipt handoff differs from the authoritative source")
            }

            ContributionHandoff.Authority(state, handoff)

            let current = state.Current()
            let incomplete = (current?.Value() ?? default(JsonElement)).GetRawText() == (
                contribution?.Value() ?? default(JsonElement)
            ).GetRawText() && RequestMetadata.Incomplete(metadata)

            if receipt.Incomplete.ValueKind != (incomplete ? JsonValueKind.True: JsonValueKind.Undefined) {
                throw CliFailure("stale_approval", "Receipt completion state differs from the current contribution")
            }

            let outcome = current?.Outcome
            let exactHead = outcome?.Head ?? ""

            if paths {
                ContributionHandoff.Candidate(handoff, J.Text(metadata, "fork"), exactHead)
            }

            let donor = RepositoryIdentity.Login(receipt.Donor)
            let record = state.Check(repo, receipt.Issue, donor, contribution?.ActorValue() ?? default(JsonElement))
            let publicationRevision = state.PublicationRevision
            let authenticated = publicationRevision == "" ? state: CoordinationState.At(
                repo,
                receipt.Issue,
                publicationRevision
            )

            VerifyPublicationAuthority(repo, receipt, state, contribution, current, authenticated)

            let policy = VerifyContributionIdentity(
                repo,
                number,
                pull,
                receipt,
                state,
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
            contribution CoordinationState.PublicationRecord?
        ) {
            if contribution == nil &&
                state.ApprovalId == receipt.Approval &&
                state.Sha == receipt.Expected &&
                RepositoryIdentity
                .SameRepo(receipt.Repo, repo) {
                let reservation = state.Lease
                if (reservation?.Reservation ?? "") == receipt.Reservation && J.Text(
                    J.Get(pull, "head"),
                    "sha"
                ) == receipt
                    .Head {
                    state.Check(repo, receipt.Issue, receipt.Donor, reservation?.ActorValue() ?? default(JsonElement))
                    LeaseLifecycle.Owner(state, reservation?.ActorValue() ?? default(JsonElement), active: true)
                    throw CliFailure(
                        "evidence_pending",
                        "PR publication is awaiting coordinator adoption. Wait, then run tokate checks " +
                            repo +
                            "#" +
                            number.ToString() + " again."
                    )
                }
            }

            if state.ApprovalId != receipt.Approval || contribution == nil {
                throw CliFailure("stale_approval", "PR approval or contribution no longer matches")
            }
        }

        private func VerifyPublicationAuthority(
            repo string,
            receipt ContributionReceipt.Record,
            value CoordinationState,
            contribution CoordinationState.PublicationRecord?,
            current CoordinationState.PublicationRecord?,
            authenticated CoordinationState
        ) {
            if !RequestData.Same(
                authenticated.Contribution?.Value() ?? default(JsonElement),
                contribution?.Value() ?? default(JsonElement)
            ) ||
                !RequestData.Same(
                authenticated.Current()?.Value() ?? default(JsonElement),
                current?.Value() ?? default(JsonElement)
            ) ||
                authenticated.ApprovalId != value.ApprovalId ||
                !RequestData
                .Same(
                authenticated.Identity?.Value() ?? default(JsonElement),
                value.Identity?.Value() ?? default(JsonElement)
            ) {
                throw CliFailure("stale_approval", "Publication revision differs from current contribution evidence")
            }

            let publishedLease = authenticated.Lease
            let publishedIdentity = authenticated.Identity

            if (publishedLease?.Status ?? "") != "active" ||
                (publishedLease?.Attempt ?? "") == "" ||
                (publishedIdentity?.Id ?? "") != (publishedLease?.Reservation ?? "") ||
                RepositoryIdentity.PositiveId(
                publishedIdentity?.ActorValue() ?? default(JsonElement)
            ) != RepositoryIdentity.PositiveId(contribution?.ActorValue() ?? default(JsonElement)) ||
                RepositoryIdentity.PositiveId(
                publishedLease?.ActorValue() ?? default(JsonElement)
            ) != RepositoryIdentity
                .PositiveId(contribution?.ActorValue() ?? default(JsonElement)) {
                throw CliFailure("stale_approval", "Publication revision lacks authenticated active attempt authority")
            }

            LeaseLifecycle.Fence(
                authenticated,
                (current?.Metadata ?? default(JsonElement)).ValueKind == JsonValueKind.Object ?
                J.Text(current?.Metadata ?? default(JsonElement), "attempt"): current?.Attempt ?? ""
            )

            let stateCommit = GitHub.Api("repos/" + repo + "/git/commits/" + authenticated.Sha)
            let parents = J.Items(J.Get(stateCommit, "parents"))
            let expected = receipt.Expected

            if parents.Count != 1 || J.Text(parents[0], "sha") != expected || (current?.Expected ?? "") != expected {
                throw CliFailure("stale_approval", "Receipt does not match the authoritative contribution revision")
            }
        }

        private func VerifyContributionIdentity(
            repo string,
            number int32,
            pull JsonElement,
            receipt ContributionReceipt.Record,
            value CoordinationState,
            contribution CoordinationState.PublicationRecord?,
            metadata JsonElement,
            outcome CoordinationState.ResultRecord?,
            exactHead string,
            donor string,
            record JsonElement
        ) Policy {
            let approval = J.Get(record, "approval")
            let reservation = value.Lease
            let head = J.Get(pull, "head")
            let headRepo = J.Get(head, "repo")
            let base = J.Get(pull, "base")
            let approvalId = value.ApprovalId
            let reservationId = reservation?.Reservation ?? ""
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

            if (outcome?.Pr ?? 0) != number || receiptHead != exactHead {
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

            if donor != (contribution?.Donor ?? "") {
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
                contribution?.ActorValue() ?? default(JsonElement)
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
            current CoordinationState.PublicationRecord?,
            contribution CoordinationState.PublicationRecord?,
            policy Policy,
            exactHead string,
            metadata JsonElement,
            pull JsonElement
        ) JsonElement {
            let amendment = receipt.Amendment

            if (current?.Value() ?? default(JsonElement)).GetRawText() != (
                contribution?.Value() ?? default(JsonElement)
            )
                .GetRawText() {
                Amendment.ValidateReceipt(amendment, policy, exactHead)

                let reportData = J.Select(amendment, "previous,seconds")
                reportData["head"] = exactHead
                reportData["tools"] = J.Get(amendment, "tools")
                PublicSummary.Attach(reportData, current?.Summary ?? default(JsonElement))
                let report = PrBody.PublicReport(J.Parse(J.Write(reportData)), metadata)

                if !RequestData.Same(J.Get(amendment, "summary"), current?.Summary ?? default(JsonElement)) {
                    throw CliFailure("stale_approval", "PR amendment summary differs from coordination authority")
                }

                let observedReport = PrBody.ReportText(J.Text(pull, "body"))

                if observedReport != report {
                    throw CliFailure("stale_approval", "PR amendment report differs from coordination authority")
                }

                let failure = "Amendment receipt differs from current coordination record"

                if J.Text(amendment, "id") != (current?.Request ?? "") || J.Text(amendment, "previous") != (
                    current?.Previous ?? ""
                ) ||
                    J.Number(amendment, "seconds") != (current?.Seconds ?? 0) {
                    throw CliFailure("stale_approval", failure)
                }

                if RequestData.Canonical(J.Get(amendment, "tools")) != RequestData.Canonical(
                    current?.Tools ?? default(JsonElement)
                ) {
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
            current CoordinationState.PublicationRecord?,
            metadata JsonElement,
            contribution CoordinationState.PublicationRecord?,
            receipt ContributionReceipt.Record,
            state CoordinationState,
            amendment JsonElement,
            paths bool
        ) Data {
            let reservation = state.Lease
            let approval = J.Get(record, "approval")
            let fork = J.Text(metadata, "fork")

            let baseline = J.Text(amendment, "base") == "" ? reservation?.Base ?? "": J.Text(amendment, "base")

            if J.Text(amendment, "base") != (current?.Base ?? "") {
                throw CliFailure("stale_approval", "Amendment base differs from coordination authority")
            }

            if baseline != (reservation?.Base ?? "") {
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

            AccessState.Check(
                repo,
                receipt.Issue,
                approval,
                contribution?.ActorValue() ?? default(JsonElement),
                J.Get(record, "policy")
            )

            let run = Data()

            run.Fields["version"] = 2
            run.Fields["repo"] = repo
            run.Fields["pr"] = number
            run.Fields["commit"] = exactHead
            run.Fields["pr_url"] = J.Text(pull, "html_url")
            run.Fields["policy"] = J.Get(record, "policy")
            let authority = (current?.Summary ?? default(JsonElement)).ValueKind == JsonValueKind.Undefined ?
            J.Get(metadata, "summary"): current?.Summary ?? default(JsonElement)

            if (current?.Value() ?? default(JsonElement)).GetRawText() == (
                contribution?.Value() ?? default(JsonElement)
            ).GetRawText() {
                run.Fields["public_report"] = PrBody.PublicReport(metadata).Trim()
            }

            if authority.ValueKind != JsonValueKind.Undefined {
                run.Fields["public_summary"] = authority
            }

            ReceiptVerification.Binding(run, receipt, approval, state.Sha, reservation?.Base ?? "")
            run.Fields["verified_target_revision"] = baseline

            return run
        }
    }
}
