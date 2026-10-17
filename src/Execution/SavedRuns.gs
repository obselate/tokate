package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Linq
import System.Text.Json

internal class SavedRun(location string, value JsonElement, current bool, run Data) {
    internal let Location string = location
    internal let Value JsonElement = value
    internal let Run Data = run
    internal let Current bool = current
    internal let Created DateTime = Directory.GetCreationTimeUtc(location)
    internal let Modified DateTime = File.GetLastWriteTimeUtc(Path.Combine(location, "run.json"))
    internal var Number int32 = RunStorage.Number(location, RunStorage.Prefix(run.Repo, run.Issue))
    internal var Outcome string = ""

    internal prop Issue int32 -> Run.Issue

    internal prop Name string -> Run.Repo + "#" + Issue.ToString() + "-" + Number.ToString()

    internal prop State string -> Outcome == "" ? Run.State: Outcome

    internal prop Finished bool -> Outcome != "" || Array.IndexOf(
        []string{"failed", "refused", "skipped"},
        Run.State
    ) >= 0

    internal prop Next string -> Outcome != "" ||
        Busy() ? "": (Run.State == "claim_pending" || Run.State == "claimed") &&
        Run.Source == "tokate" ? "work":
    Run.Pr > 0 ? "checks":
    Run.State == "generated" || Run.State == "incomplete_generated" ? "submit": ""

    internal func Busy() bool {
        if !File.Exists(Path.Combine(Location, ".lock")) {
            return false
        }

        try {
            using let lease = RunStorage.Lock(Location)
            return false
        } catch (error IOException) {
            return true
        }
    }

    internal func Pull(repo string, pr int32) bool -> Run.Pr == pr && String.Equals(
        Run.Repo,
        repo,
        StringComparison.OrdinalIgnoreCase
    )

    internal func Age() string {
        let minutes = Math.Max(0, Convert.ToInt32(Math.Floor((DateTime.UtcNow - Modified).TotalMinutes)))
        return minutes < RuntimeBudget.MinutesPerHour ? minutes.ToString() +
            "m": minutes < 1440 ? (minutes / RuntimeBudget.MinutesPerHour).ToString() + "h":
        (minutes / 1440).ToString() + "d"
    }

    internal func Matches(repo string, issue int32) bool -> Issue == issue && String.Equals(
        Run.Repo,
        repo,
        StringComparison.OrdinalIgnoreCase
    )

    internal func Summary() Dictionary[string, Object?] -> map[string, Object?]{
        "run": Location,
        "name": Name,
        "storage": Current ? "current": "previous",
        "id": Run.Id,
        "repo": Run.Repo,
        "issue": Issue,
        "number": Number,
        "donor": Run.Donor,
        "model": Run.Model,
        "state": Run.State,
        "pr": Run.Pr,
        "outcome": Outcome,
        "finished": Finished,
        "modified": Modified.ToString("yyyy-MM-ddTHH:mm:ssZ")
    }
}

internal class SavedRuns {
    internal let Rows List[SavedRun] = List[SavedRun]()
    internal var Skipped int32
    internal let SkippedEntries List[Object?] = List[Object?]()
    internal var Truncated bool

    shared {
        internal const SummaryCountLimit int32 = 128

        internal func Summary(
            rows List[SavedRun],
            skipped int32,
            truncated bool = false,
            skippedEntries List[Object?]? = nil
        ) Dictionary[string, Object?] {
            let items = List[Object?]()

            for row in rows {
                if items.Count == SummaryCountLimit {
                    break
                }

                items.Add(row.Summary())
            }

            return map[string, Object?]{
                "runs": items,
                "skipped": skipped,
                "skipped_entries": skippedEntries ?? List[Object?](),
                "truncated": truncated || rows.Count > items.Count
            }
        }

        internal func Recent(rows List[SavedRun]) List[SavedRun] -> rows.GetRange(
            Math.Max(0, rows.Count - 16),
            Math.Min(16, rows.Count)
        )

        internal func Pick(rows List[SavedRun]) SavedRun? {
            let active = rows.FindAll(row -> row.Run.State != "failed")
            return active.Count > 1 ? nil: active.Count == 1 ? active[0]: rows.Count > 0 ? rows[rows.Count - 1]: nil
        }

        internal func Outcomes(rows List[SavedRun]) {
            let pulls = rows.Where(row -> row.Run.Pr > 0 && !row.Finished).Take(100).ToList()

            if pulls.Count == 0 {
                return
            }

            var query = ""

            for i in 0 ... pulls.Count {
                let repo = pulls[i].Run.Repo.Split('/')
                query += "p" + i.ToString() + ":repository(owner:\"" + repo[0] + "\",name:\"" + repo[1] + "\")"
                query += "{pullRequest(number:" + pulls[i].Run.Pr.ToString() + "){state}}"
            }

            ApiTransport.BeginDeadline(10)
            try {
                let data = J.Get(GitHub.Api("graphql", map[string, Object?]{"query": "query{" + query + "}"}), "data")

                for i in 0 ... pulls.Count {
                    let state = J.Text(J.Get(J.Get(data, "p" + i.ToString()), "pullRequest"), "state")

                    if state == "MERGED" || state == "CLOSED" {
                        pulls[i].Outcome = state.ToLowerInvariant()
                    }
                }
            } catch (error Exception) { } finally {
                ApiTransport.EndDeadline()
            }
        }
    }

    internal init(roots[]string, limit int32 = Int32.MaxValue) {
        let legacy = List[SavedRun]()
        var scanned int32

        for root in roots {
            if !Directory.Exists(root) {
                continue
            }

            try {
                LocalPaths.DirectoryPath(root)
                for directory in Directory.EnumerateDirectories(root) {
                    if scanned >= limit {
                        Truncated = true
                        break
                    }

                    scanned++
                    var reason = "Unsafe saved run path."

                    try {
                        RunStorage.ControlPaths(directory)
                        reason = "Missing, invalid or oversized run metadata."
                        let value = RequestData.FileData(
                            Path.Combine(directory, "run.json"),
                            RunStorage.RunFileByteLimit
                        )

                        reason = "Invalid repository or excessive saved metadata."
                        let run = Data.Parse(value)
                        RepositoryIdentity.Repo(run.Repo)

                        for text in[]string{run.Id, run.Repo, run.Donor, run.Model, run.State} {
                            if text.Length > 256 {
                                throw ExecutionFailure.Create(
                                    "invalid_state",
                                    "Saved contribution metadata is too long"
                                )
                            }
                        }

                        reason = "Unsupported version or incomplete saved contribution."
                        Data.ValidateRequired(value)

                        reason = "Cannot load this run. Inspect it with tokate status --run " + directory + "."
                        let correction = Path.Combine(directory, "correction.json")
                        if File.Exists(correction) {
                            RunStorage.ControlFile(directory, "correction.json")
                            Data.LegacyCorrection(correction)
                        }

                        let row = SavedRun(directory, value, root == RunStorage.Root(), run)
                        Rows.Add(row)

                        if row.Number == 0 {
                            legacy.Add(row)
                        }
                    } catch (error Exception) when error is CliFailure || error.GetType() == typeof(Exception) ||
                        error is IOException ||
                        error is UnauthorizedAccessException ||
                        error is JsonException {
                        Skipped++

                        if SkippedEntries.Count < SummaryCountLimit {
                            SkippedEntries.Add(map[string, Object?]{"run": directory, "reason": reason})
                        } else {
                            Truncated = true
                        }
                    }
                }
            } catch (error Exception) when error is CliFailure || error.GetType() == typeof(Exception) ||
                error is IOException ||
                error is UnauthorizedAccessException {
                Skipped++

                if SkippedEntries.Count < SummaryCountLimit {
                    SkippedEntries.Add(map[string, Object?]{"run": root, "reason": "Unsafe or unreadable run storage."})
                } else {
                    Truncated = true
                }
            }
        }

        for row in legacy {
            var number int32 = 1

            for other in legacy {
                if other.Matches(row.Run.Repo, row.Issue) &&
                    (
                    other.Created < row.Created ||
                        (other.Created == row.Created && String.CompareOrdinal(other.Location, row.Location) < 0)
                ) {
                    number++
                }
            }

            row.Number = number
        }

        Rows.Sort(
            (a, b) -> !a.Matches(b.Run.Repo, b.Issue) ?
            StringComparer.OrdinalIgnoreCase.Compare(
                a.Run.Repo + "#" + a.Issue.ToString("D10"),
                b.Run.Repo + "#" + b.Issue.ToString("D10")
            ): a.Number != b.Number ? a
                .Number
                .CompareTo(b.Number): String.CompareOrdinal(a.Location, b.Location)
        )
    }

    internal func Has(directory string) bool {
        for row in Rows {
            if row.Location == directory {
                return true
            }
        }

        return false
    }

    internal func For(repo string, issue int32) List[SavedRun] {
        let rows = List[SavedRun]()

        for row in Rows {
            if row.Matches(repo, issue) {
                rows.Add(row)
            }
        }

        return rows
    }
}
