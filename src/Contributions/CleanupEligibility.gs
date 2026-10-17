package Tokate

import System
import System.IO
import System.Text.Json

internal class CleanupEligibility {
    shared {
        internal func Reason(row SavedRun, leased bool = false) string {
            try {
                RunStorage.ControlPaths(row.Location)

                if !leased && row.Busy() {
                    return "Run is in use."
                }

                let pr = row.Run.Pr

                if pr == 0 {
                    if Unpublished(row, "") {
                        return "Unpublished verified work or publication cannot be established."
                    }

                    if !row.Finished {
                        return "Run is not finished."
                    }
                }

                let repo = row.Run.Repo
                let issue = GitHub.Api("repos/" + repo + "/issues/" + row.Issue.ToString())
                let state = J.Text(issue, "state")

                if state == "open" {
                    return "Issue is open."
                }

                if state != "closed" || J.Get(issue, "pull_request").ValueKind != JsonValueKind.Undefined {
                    return "Cannot establish that the issue is closed."
                }

                let coordination = CoordinationState.Load(repo, row.Issue, true).Value()
                let reservation = J.Get(coordination, "reservation")

                if reservation.ValueKind != JsonValueKind.Undefined &&
                    reservation.ValueKind != JsonValueKind.Null &&
                    reservation.ValueKind != JsonValueKind.Object {
                    return "Cannot establish reservation state."
                }

                if reservation.ValueKind == JsonValueKind.Object && J.Text(reservation, "status") != "released" &&
                    CoordinationState.Unix(reservation, "expires") > DateTimeOffset.UtcNow.ToUnixTimeSeconds() {
                    return "Active reservation."
                }

                var head = ""

                if pr > 0 {
                    let pull = GitHub.Api("repos/" + repo + "/pulls/" + pr.ToString())

                    if J.Text(pull, "state") != "closed" {
                        return "PR is open or its closed state cannot be established."
                    }

                    head = RepositoryIdentity.CommitSha(J.Text(J.Get(pull, "head"), "sha"))
                }

                if pr > 0 && Unpublished(row, head) {
                    return "Unpublished verified work or publication cannot be established."
                }

                return ""
            } catch (error Exception) when error is CliFailure ||
                error is IOException ||
                error is UnauthorizedAccessException ||
                error is JsonException ||
                error.GetType() == typeof(Exception) {
                return "Cannot check required state: " + error.Message
            }
        }

        private func Unpublished(row SavedRun, head string) bool {
            if File.Exists(Path.Combine(row.Location, "correction.json")) {
                return true
            }

            let commit = row.Run.Commit

            if head == "" {
                if commit != "" ||
                    row
                    .Run
                    .State == "generated" ||
                    row
                    .Run
                    .State == "incomplete_generated" ||
                    row
                    .Run
                    .TurnCompleted {
                    return true
                }
            } else if commit == "" || commit != head {
                return true
            }

            let amendments = Path.Combine(row.Location, "amendments")

            if Directory.Exists(amendments) {
                LocalPaths.DirectoryPath(amendments)

                for directory in Directory.EnumerateDirectories(amendments) {
                    RunStorage.ControlPaths(directory)
                    let value = RequestData.FileData(Path.Combine(directory, "run.json"), RunStorage.RunFileByteLimit)

                    if J.Text(value, "state") != "published" {
                        return true
                    }
                }
            }

            return false
        }
    }
}
