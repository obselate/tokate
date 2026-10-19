package Tokate

import System
import System.IO
import System.Text.Json

internal class ReservationRequest {
    shared {
        internal func Inspect(directory string) JsonElement {
            let run = Data.Load(directory)
            let viewer = GitHub.Api("user")

            if !RepositoryIdentity.SameDonor(viewer, run.Donor, run.DonorId) {
                throw CliFailure("authentication_required", "Active GitHub account differs from the saved donor")
            }

            let state = CoordinationState.Load(run.Repo, run.Issue)
            let request = run.ReservationRequest
            var actions[]string

            if request.ValueKind != JsonValueKind.Undefined {
                let declaration = RequestMetadata.Request(request)
                if !LeaseLifecycle.Transition(declaration.Action) {
                    throw CliFailure("invalid_state", "Invalid saved reservation request")
                }

                actions = []string{declaration.Action}
            } else {
                if (state.Identity?.Id ?? "") != run.Id {
                    throw CliFailure("stale_approval", "Saved contribution ownership was replaced")
                }

                LeaseLifecycle.Owner(state, J.Get(viewer, "id"))
                actions = []string{(state.Lease?.Status ?? "") == "paused" ? "resume": "pause", "renew", "release"}
            }

            return J.Parse(
                J.Write(
                    map[string, Object?]{
                        "status": state.Lease?.Status ?? "",
                        "pending_request": request.ValueKind != JsonValueKind.Undefined,
                        "actions": actions
                    }
                )
            )
        }

        private func Result(directory string, run Data, state CoordinationState, request JsonElement) int32 {
            let declaration = CoordinatorRequest.Parse(request)
            let outcome = RequestMetadata.Recorded(state, run.DonorId, request)
            let pending = outcome == nil

            Output
                .Sink
                .ResultData = map[string, Object?]{
                "run_directory": directory,
                "operation": declaration.Action,
                "pending": pending,
                "state_sha": state.Sha,
                "reservation": state.Lease?.Value(),
                "outcome": outcome?.Value()
            }

            if pending {
                Output.Sink.Actions.Add([]string{"tokate", declaration.Action, "--run", directory, "--json"})
                Output.Sink.Message("Reservation request pending. Saved work: " + directory)
                return Output.PendingExitCode
            }

            run.ClearReservationRequest()
            run.Save(directory)
            Output.Sink.Message("Reservation " + declaration.Action + " accepted. Saved work: " + directory)

            return 0
        }

        private func InvalidState(directory string, run Data, action string) CliFailure -> CliFailure(
            "invalid_state",
            "Cannot " +
                action +
                " saved run in state " +
                run.State +
                ". Inspect it with tokate status --run " +
                directory
        )

        internal func Run(args Args) int32 {
            let directory = Path.GetFullPath(args.Need("run"))
            using let lease = RunStorage.Lease(directory)
            let run = Data.Load(directory)
            Output.Sink.RunDirectory = directory
            let action = args.Command

            if !LeaseLifecycle.Transition(action) ||
                run.Version != Data.FormatVersion ||
                (run.Id == "" && !(action == "release" && run.State == "claim_pending")) {
                throw InvalidState(directory, run, action)
            }

            let viewer = GitHub.Api("user")

            if !RepositoryIdentity.SameDonor(viewer, run.Donor, run.DonorId) {
                throw CliFailure("authentication_required", "Active GitHub account differs from the saved donor")
            }

            let repo = run.Repo
            let issue = run.Issue
            var state = CoordinationState.Load(repo, issue)
            var request = run.ReservationRequest

            if request.ValueKind != JsonValueKind.Undefined {
                let declaration = RequestMetadata.Request(request)
                let outcome = RequestMetadata.Recorded(
                    state,
                    RepositoryIdentity.PositiveId(J.Get(viewer, "id")),
                    request
                )

                if outcome == nil && declaration.Action != action {
                    throw CliFailure(
                        "invalid_state",
                        "A different reservation request is pending; inspect its outcome before another action"
                    )
                }

                if outcome != nil {
                    let result = Result(directory, run, state, request)
                    if declaration.Action == action {
                        return result
                    }

                    request = JsonElement{}
                }

                if outcome == nil && action == "release" && declaration.Expected != state.Sha {
                    request = JsonElement{}
                    run.ClearReservationRequest()
                    run.Save(directory)
                }
            }

            var contribution = run.Id
            if contribution == "" {
                if RequestMetadata.Recorded(state, run.DonorId, run.ClaimRequest) == nil {
                    if state.Sha != CoordinatorRequest.Parse(run.ClaimRequest).Expected {
                        throw InvalidState(directory, run, action)
                    }

                    Output
                        .Sink
                        .ResultData = map[string, Object?]{
                        "run_directory": directory,
                        "operation": action,
                        "pending": true,
                        "state": run.State,
                        "state_sha": state.Sha
                    }
                    Output.Sink.Actions.Add([]string{"tokate", "release", "--run", directory, "--json"})
                    Output.Sink.Message(
                        "Claim pending. Check release again after coordinator acceptance. Saved work: " +
                            directory +
                            " If the Tokate workflow failed: " +
                            ApiTransport.MutationRecovery
                    )
                    return Output.PendingExitCode
                }

                contribution = ContributionPreparation.ClaimReservation(run, viewer, state)
            }

            if (state.Identity?.Id ?? "") != contribution {
                throw CliFailure("stale_approval", "Saved contribution ownership was replaced")
            }

            LeaseLifecycle.Owner(state, J.Get(viewer, "id"))

            if request.ValueKind == JsonValueKind.Undefined {
                if action != "release" {
                    state.Check(repo, issue, run.Donor, J.Get(viewer, "id"))
                    if state.ApprovalId != run.Approval {
                        throw CliFailure("stale_approval", "Saved contribution approval changed")
                    }
                }

                let status = state.Lease?.Status ?? ""

                if (action == "pause" && status != "active") || (action == "resume" && status != "paused") {
                    throw CliFailure("invalid_state", "Reservation state does not permit this operation")
                }

                let pendingRequest = CoordinatorRequest(
                    Guid.NewGuid().ToString("D"),
                    state.Sha,
                    state.ApprovalId,
                    action,
                    J.Parse("{}")
                )
                request = J.Parse(pendingRequest.ToJson())

                run.ReservationRequest = request
                run.Save(directory)
            }

            let declaration = CoordinatorRequest.Parse(request)
            var id Guid

            if !Guid.TryParseExact(declaration.Uuid, "D", out id) || !LeaseLifecycle.Transition(declaration.Action) {
                throw CliFailure("invalid_state", "Invalid saved reservation request")
            }

            let journal = "reservation-" + id.ToString("D") + ".posting.json"
            RunStorage.ControlFile(directory, journal)

            Submission.Request(repo, issue, request, Path.Combine(directory, journal), J.Get(viewer, "id"))

            state = CoordinationState.Load(repo, issue)

            return Result(directory, run, state, request)
        }
    }
}
