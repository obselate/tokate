package Tokate

import System
import System.Text.Json

internal class ContributionAuthority {
    shared {
        internal func Recheck(run Data) JsonElement {
            if run.Number("version") != 2 {
                throw CliFailure("invalid_state", "Unsupported run protocol; start a current contribution")
            }

            WorkspacePreparation.CheckIdentity(run)

            let viewer = GitHub.Api("user")
            let repo = RepositoryIdentity.Repo(run.Text("repo"))
            let saved = run.Element()
            var record JsonElement
            if run.Flag("gratis") {
                if RepositoryIdentity.SameRepo(repo, run.Text("head_repo")) || !RepositoryIdentity.SameDonor(
                    viewer,
                    run
                ) ||
                    GitHub
                    .Api(
                    "repos/" + repo + "/contents/.github/tokate.json?ref=" + Uri.EscapeDataString(
                        run.Text("base_branch")
                    ),
                    missing: true
                )
                    .ValueKind != JsonValueKind.Undefined {
                    throw CliFailure("stale_approval", "Gratis repository or donor authority changed")
                }
                record = J.Get(saved, "gratis_context")
                let approval = J.Get(record, "approval")
                if run.Text("base") != J.Text(approval, "base") || run.Text("base_branch") != J.Text(
                    approval,
                    "base_branch"
                ) ||
                    run.Text("branch") != "tokate/gratis-" + run.Text("id") {
                    throw CliFailure("invalid_state", "Saved gratis task changed")
                }
            } else {
                let state = CoordinationState.Load(repo, run.Number("issue"))
                let value = state.Value()
                let reservation = J.Get(value, "reservation")

                if !RepositoryIdentity.SameDonor(viewer, run) || J.Text(value, "approval_id") != run.Text("approval") ||
                    J.Text(reservation, "reservation") != run.Text("id") {
                    throw CliFailure("stale_approval", "Saved run has stale coordination authority")
                }

                RepositoryIdentity.PositiveId(J.Get(saved, "donor_id"))
                state.Reservation(J.Get(viewer, "id"))

                if run.Text("attempt") != J.Text(reservation, "attempt") || RepositoryIdentity.PositiveId(
                    J.Get(saved, "donor_id")
                ) != RepositoryIdentity
                    .PositiveId(J.Get(J.Get(value, "identity"), "actor")) {
                    throw CliFailure(
                        "stale_approval",
                        "Saved execution attempt fence changed; old work is preserved",
                        attemptInvalidated: true
                    )
                }

                record = state.Check(repo, run.Number("issue"), run.Text("donor"), J.Get(viewer, "id"))
                ContributionHandoff.Authority(state, J.Get(run.Element(), "handoff"))

                let approval = J.Get(record, "approval")

                if run.Text("base") != J.Text(reservation, "base") || run.Text("policy_hash") != J.Text(
                    approval,
                    "policy_hash"
                ) ||
                    run.Text("branch") != "tokate/v2-" + run.Text("id") || run.Text("base_branch") != J.Text(
                    approval,
                    "base_branch"
                ) {
                    throw CliFailure("stale_approval", "Saved run differs from reservation and approval")
                }

                AttemptContinuation.Recheck(run, state)
            }

            let policy = Policy(J.Write(J.Get(record, "policy")))
            let declaredTools = J.Get(saved, "tools")

            RequestMetadata.Tools(declaredTools)
            policy.ValidateTools(declaredTools, run.Text("source"))

            if run.Fields.ContainsKey("requested_model") && run.Text("requested_model") != run.Text("model") {
                throw CliFailure("stale_approval", "Saved requested model differs from execution")
            }

            let tools = J.Items(declaredTools)

            if run.Text("source") == "tokate" &&
                (run.Text("model") != J.Text(tools[0], "model") || run.Text("effort") != J.Text(tools[0], "effort")) {
                throw CliFailure(
                    "stale_approval",
                    "Saved execution differs from the declared tool; no model substitution is allowed"
                )
            }

            RepositoryIdentity.Repo(run.Text("head_repo"))

            if run.Text("state") != "preparing" {
                RepositoryAccess.ValidateRun(run)
            }

            RuntimeBudget.Validate(run)
            policy.ValidateBudget(run.Number("seconds"), run.Flag("unlimited"))
            return record
        }
    }
}
