package Tokate

import System
import System.IO
import System.Text.Json

internal class ReservationRequest {
    shared {
        internal func Inspect(directory string) JsonElement {
            let run = Data.Load(directory)
            let viewer = GitHub.Api("user")

            if !RepositoryIdentity.SameDonor(viewer, run) {
                throw CliFailure("authentication_required", "Active GitHub account differs from the saved donor")
            }

            let state = CoordinationState.Load(run.Text("repo"), run.Number("issue"))
            let request = J.Get(run.Element(), "reservation_request")
            var actions[]string

            if request.ValueKind != JsonValueKind.Undefined {
                let declaration = RequestMetadata.Request(request)
                if !LeaseLifecycle.Transition(declaration.Action) {
                    throw CliFailure("invalid_state", "Invalid saved reservation request")
                }

                actions = []string{declaration.Action}
            } else {
                if J.Text(J.Get(state.Value(), "identity"), "id") != run.Text("id") {
                    throw CliFailure("stale_approval", "Saved contribution ownership was replaced")
                }

                LeaseLifecycle.Owner(state, J.Get(viewer, "id"))
                actions = []string{
                    J.Text(J.Get(state.Value(), "reservation"), "status") == "paused" ? "resume": "pause",
                    "renew",
                    "release"
                }
            }

            return J.Parse(
                J.Write(
                    map[string, Object?]{
                        "status": J.Text(J.Get(state.Value(), "reservation"), "status"),
                        "pending_request": request.ValueKind != JsonValueKind.Undefined,
                        "actions": actions
                    }
                )
            )
        }

        private func Result(directory string, run Data, state CoordinationState, request JsonElement) int32 {
            let declaration = CoordinatorRequest.Parse(request)
            let outcome = RequestMetadata.Recorded(state.Value(), J.Get(run.Element(), "donor_id"), request)
            let pending = outcome.ValueKind == JsonValueKind.Undefined

            Output
                .Sink
                .ResultData = map[string, Object?]{
                "run_directory": directory,
                "operation": declaration.Action,
                "pending": pending,
                "state_sha": state.Sha,
                "reservation": J.Get(state.Value(), "reservation"),
                "outcome": pending ? nil: outcome as Object
            }

            if pending {
                Output.Sink.Actions.Add([]string{"tokate", declaration.Action, "--run", directory, "--json"})
                Output.Sink.Message("Reservation request pending. Saved work: " + directory)
                return 8
            }

            run.Fields.Remove("reservation_request")
            run.Save(directory)
            Output.Sink.Message("Reservation " + declaration.Action + " accepted. Saved work: " + directory)

            return 0
        }

        internal func Run(args Args) int32 {
            let directory = Path.GetFullPath(args.Need("run"))
            using let lease = RunStorage.Lease(directory)
            let run = Data.Load(directory)
            Output.Sink.RunDirectory = directory
            let action = args.Command

            if !LeaseLifecycle.Transition(action) || run.Number("version") != 2 || run.Text("id") == "" {
                throw CliFailure("invalid_state", "Choose pause, resume, renew or release for a prepared version 2 run")
            }

            let viewer = GitHub.Api("user")

            if !RepositoryIdentity.SameDonor(viewer, run) {
                throw CliFailure("authentication_required", "Active GitHub account differs from the saved donor")
            }

            let repo = run.Text("repo")
            let issue = run.Number("issue")
            var state = CoordinationState.Load(repo, issue)
            var request = J.Get(run.Element(), "reservation_request")

            if request.ValueKind != JsonValueKind.Undefined {
                let declaration = RequestMetadata.Request(request)
                let outcome = RequestMetadata.Recorded(state.Value(), J.Get(viewer, "id"), request)

                if outcome.ValueKind == JsonValueKind.Undefined && declaration.Action != action {
                    throw CliFailure(
                        "invalid_state",
                        "A different reservation request is pending; inspect its outcome before another action"
                    )
                }

                if outcome.ValueKind != JsonValueKind.Undefined {
                    let result = Result(directory, run, state, request)
                    if declaration.Action == action {
                        return result
                    }

                    request = JsonElement{}
                }

                if outcome.ValueKind == JsonValueKind.Undefined &&
                    action == "release" &&
                    declaration.Expected != state.Sha {
                    request = JsonElement{}
                    run.Fields.Remove("reservation_request")
                    run.Save(directory)
                }
            }

            let value = state.Value()

            if J.Text(J.Get(value, "identity"), "id") != run.Text("id") {
                throw CliFailure("stale_approval", "Saved contribution ownership was replaced")
            }

            LeaseLifecycle.Owner(state, J.Get(viewer, "id"))

            if request.ValueKind == JsonValueKind.Undefined {
                if action != "release" {
                    state.Check(repo, issue, run.Text("donor"), J.Get(viewer, "id"))
                    if J.Text(value, "approval_id") != run.Text("approval") {
                        throw CliFailure("stale_approval", "Saved contribution approval changed")
                    }
                }

                let status = J.Text(J.Get(value, "reservation"), "status")

                if (action == "pause" && status != "active") || (action == "resume" && status != "paused") {
                    throw CliFailure("invalid_state", "Reservation state does not permit this operation")
                }

                let pendingRequest = CoordinatorRequest(
                    Guid.NewGuid().ToString("D"),
                    state.Sha,
                    J.Text(value, "approval_id"),
                    action,
                    J.Parse("{}")
                )
                request = J.Parse(pendingRequest.ToJson())

                run.Fields["reservation_request"] = request
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
