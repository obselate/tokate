package Tokate

import System
import System.Text.Json

internal class ContributionAuthority {
    shared {
        internal func Recheck(run Data) JsonElement {
            if run.Version != 2 {
                throw CliFailure("invalid_state", "Unsupported run protocol; start a current contribution")
            }

            WorkspacePreparation.CheckIdentity(run)

            let viewer = GitHub.Api("user")
            let repo = RepositoryIdentity.Repo(run.Repo)
            var record JsonElement
            if run.Gratis {
                if RepositoryIdentity.SameRepo(repo, run.HeadRepo) || !RepositoryIdentity.SameDonor(viewer, run) ||
                    GitHub
                    .Api(
                    "repos/" + repo + "/contents/" + Policy.FilePath + "?ref=" + Uri.EscapeDataString(run.BaseBranch),
                    missing: true
                )
                    .ValueKind != JsonValueKind.Undefined {
                    throw CliFailure("stale_approval", "Gratis repository or donor authority changed")
                }
                record = run.GratisContext
                let approval = OwnerApproval.Record.Parse(J.Get(record, "approval"))
                if run.Base != approval.Base ||
                    run.BaseBranch != approval.BaseBranch ||
                    run.Branch != "tokate/gratis-" +
                    run.Id {
                    throw CliFailure("invalid_state", "Saved gratis task changed")
                }
            } else {
                let state = CoordinationState.Load(repo, run.Issue)
                let reservation = state.Lease

                if !RepositoryIdentity.SameDonor(viewer, run) ||
                    state.ApprovalId != run.Approval ||
                    (reservation?.Reservation ?? "") != run.Id {
                    throw CliFailure("stale_approval", "Saved run has stale coordination authority")
                }

                RepositoryIdentity.PositiveId(run.DonorId)
                state.Reservation(J.Get(viewer, "id"))

                if run.Attempt != (reservation?.Attempt ?? "") || RepositoryIdentity.PositiveId(
                    run.DonorId
                ) != RepositoryIdentity
                    .PositiveId(state.Identity?.ActorJson ?? default(JsonElement)) {
                    throw CliFailure(
                        "stale_approval",
                        "Saved execution attempt fence changed; old work is preserved",
                        attemptInvalidated: true
                    )
                }

                record = state.Check(repo, run.Issue, run.Donor, J.Get(viewer, "id"))
                ContributionHandoff.Authority(state, ContributionHandoff.Declaration(run.Handoff))

                let approval = OwnerApproval.Record.Parse(J.Get(record, "approval"))

                if run.Base != (reservation?.Base ?? "") ||
                    run.PolicyHash != approval.PolicyHash ||
                    run.Branch != GitHub.ContributionBranchPrefix +
                    run.Id ||
                    run.BaseBranch != approval.BaseBranch {
                    throw CliFailure("stale_approval", "Saved run differs from reservation and approval")
                }

                AttemptContinuation.Recheck(run, state)
            }

            let policy = Policy(J.Write(J.Get(record, "policy")))
            let declaredTools = run.Tools

            RequestMetadata.Tools(declaredTools)
            policy.ValidateTools(declaredTools, run.Source)

            if run.HasRequestedModel && run.RequestedModel != run.Model {
                throw CliFailure("stale_approval", "Saved requested model differs from execution")
            }

            let tools = J.Items(declaredTools)

            if run.Source == "tokate" &&
                (run.Model != J.Text(tools[0], "model") || run.Effort != J.Text(tools[0], "effort")) {
                throw CliFailure(
                    "stale_approval",
                    "Saved execution differs from the declared tool; no model substitution is allowed"
                )
            }

            RepositoryIdentity.Repo(run.HeadRepo)

            if run.State != "preparing" {
                RepositoryAccess.ValidateRun(run)
            }

            RuntimeBudget.Validate(run)
            policy.ValidateBudget(run.Seconds, run.Unlimited)
            return record
        }
    }
}
