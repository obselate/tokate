package Tokate

import System
import System.Text.Json

internal class LeaseLifecycle {
    shared {
        internal func Supported(state CoordinationState) bool -> state.Identity != nil

        internal func Transition(action string) bool -> action == "renew" ||
            action == "pause" ||
            action == "resume" ||
            action == "release"

        internal func Owner(state CoordinationState, actor JsonElement, active bool = false) {
            let reservation = state.Lease

            if reservation == nil {
                throw CliFailure("stale_approval", "The reservation is gone. Return to the owner.")
            }

            RepositoryIdentity.PositiveId(actor)

            if RepositoryIdentity.PositiveId(reservation.ActorValue()) != RepositoryIdentity.PositiveId(actor) ||
                reservation.Expires <= DateTimeOffset
                .UtcNow
                .ToUnixTimeSeconds() || reservation.Status == "released" {
                throw CliFailure("stale_approval", "Lease expired, released or belongs to another numeric donor")
            }

            let identity = state.Identity
            var id Guid
            var lease Guid

            if !Guid.TryParseExact(reservation.Lease, "D", out lease) || lease.ToString("D") != reservation.Lease ||
                !Guid.TryParseExact(identity?.Id ?? "", "D", out id) || id.ToString("D") != (identity?.Id ?? "") {
                throw CliFailure("invalid_state", "Incomplete lease or contribution identity")
            }

            if (identity?.Id ?? "") != reservation.Reservation || RepositoryIdentity.PositiveId(
                identity?.ActorValue() ?? default(JsonElement)
            ) != RepositoryIdentity.PositiveId(actor) {
                throw CliFailure("invalid_state", "Lease differs from the contribution identity")
            }

            let status = reservation.Status

            if status == "active" {
                var attempt Guid
                if !Guid.TryParseExact(reservation.Attempt, "D", out attempt) || attempt.ToString(
                    "D"
                ) != reservation.Attempt {
                    throw CliFailure("invalid_state", "Active lease needs a canonical attempt identity")
                }
            } else if status == "paused" {
                if reservation.Attempt != "" {
                    throw CliFailure("invalid_state", "Paused lease cannot retain an active attempt")
                }
            } else {
                throw CliFailure("invalid_state", "Unsupported lease lifecycle state")
            }

            if active && status != "active" {
                throw CliFailure("stale_approval", "No active coding attempt; resume grants a fresh fence only")
            }
        }

        internal func Fence(state CoordinationState, attempt string) {
            if attempt != (state.Lease?.Attempt ?? "") {
                throw CliFailure("stale_approval", "Publication attempt fence was invalidated or replaced")
            }
        }

        internal func Apply(
            state CoordinationState,
            request JsonElement,
            actor JsonElement,
            donor string,
            policy JsonElement
        ) CoordinationState
            .ResultRecord {
            let reservation = state.Lease
            let declaration = CoordinatorRequest.Parse(request)
            let action = declaration.Action
            let uuid = declaration.Uuid
            let now = DateTimeOffset.UtcNow.ToUnixTimeSeconds()

            if action == "claim" {
                return Claim(state, actor, donor, uuid, now, Policy.Parse(policy).ReservationSeconds)
            }

            if !Supported(state) {
                throw CliFailure(
                    "stale_approval",
                    "Legacy lease transitions are unsupported; fresh owner approval is required"
                )
            }

            Owner(state, actor)

            let status = reservation?.Status ?? ""
            if (action == "pause" && status != "active") || (action == "resume" && status != "paused") {
                throw CliFailure("invalid_state", "Lifecycle transition does not match the current lease state")
            }

            Pin(state)

            guard let lease = reservation else {
                throw Exception("Missing validated reservation")
            }

            if action == "release" {
                lease.Update(donor, now, "released", "", true)
            } else {
                let duration = Policy.Parse(policy).ReservationSeconds
                let expires = action == "pause" ? now + duration: Math.Max(lease.Expires, now + duration)
                let nextStatus = action == "pause" ? "paused": action == "resume" ? "active": lease.Status
                let attempt = action == "pause" ? "": action == "resume" ? uuid: lease.Attempt
                lease.Update(donor, expires, nextStatus, attempt, action != "renew")
            }

            state.Include("reservation")

            return CoordinationState.ResultRecord{Lease: lease, Reservation: lease.Reservation}
        }

        private func Claim(
            state CoordinationState,
            actor JsonElement,
            donor string,
            uuid string,
            now int64,
            duration int32
        ) CoordinationState
            .ResultRecord {
            let reservation = state.Lease
            let identity = state.Identity

            if reservation != nil && reservation.Status != "released" && reservation.Expires > now {
                throw CliFailure("invalid_state", "An unexpired reservation already owns this contribution")
            }

            if reservation != nil && !Supported(state) {
                throw CliFailure(
                    "stale_approval",
                    "Legacy lease reacquisition is unsupported; fresh owner approval is required"
                )
            }

            let task = state.Approval
            let repo = state.Repo
            let same = Supported(state) && RepositoryIdentity.PositiveId(
                identity?.ActorValue() ?? default(JsonElement)
            ) == RepositoryIdentity.PositiveId(actor)
            let base = same ? RepositoryIdentity.CommitSha(reservation?.Base ?? ""):
            GitHub.Branch(repo, task?.BaseBranch ?? "")
            let approved = RepositoryIdentity.CommitSha(task?.Base ?? "")
            let authority = GitHub.Branch(repo, task?.AuthorityBranch ?? "")

            if Policy.Load(repo, authority).Digest != (task?.PolicyHash ?? "") {
                throw CoordinationState.ApprovalFailure(repo, state.Issue, "Repository policy changed.")
            }

            if base != approved {
                let comparison = GitHub.Api(
                    "repos/" + repo + "/compare/" + approved + "..." + repo.Split('/')[0] + ":" + base
                )
                if J.Text(comparison, "status") != "ahead" || J.Text(
                    J.Get(comparison, "merge_base_commit"),
                    "sha"
                ) != approved {
                    throw CoordinationState.ApprovalFailure(
                        repo,
                        state.Issue,
                        "Target no longer descends from the approved base."
                    )
                }
            }

            let id = same ? identity?.Id ?? "": uuid

            if !same {
                let next = CoordinationState.IdentityRecord{Id: id, Actor: actor.GetInt64(), ActorJson: actor}

                if Supported(state) {
                    next.Predecessor = CoordinationState
                        .IdentityRecord{
                        Revision: state.Sha,
                        Id: identity?.Id ?? "",
                        Actor: identity?.Actor ?? 0,
                        ActorJson: identity?.ActorValue() ?? default(JsonElement)
                    }
                }

                state.Identity = next
                state.Contribution = nil
                state.Amendments.Clear()
                state.PublicationRevision = ""
                for name in[]string{"identity", "contribution", "amendments", "publication_revision"} {
                    state.Include(name)
                }
            } else {
                Pin(state)
            }

            let outcome = CoordinationState
                .LeaseRecord{
                Reservation: id,
                Base: base,
                Lease: uuid,
                Donor: donor,
                Actor: actor.GetInt64(),
                ActorJson: actor,
                Created: now,
                Expires: now + duration,
                Status: "active",
                Attempt: uuid
            }

            state.Lease = outcome
            state.Include("reservation")

            return CoordinationState.ResultRecord{Lease: outcome, Reservation: id}
        }

        private func Pin(state CoordinationState) {
            if state.Contribution != nil && state.PublicationRevision == "" {
                state.PublicationRevision = state.Sha
                state.Include("publication_revision")
            }
        }
    }
}
