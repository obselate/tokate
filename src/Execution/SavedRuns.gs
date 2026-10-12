package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class SavedRun(location string, value JsonElement, current bool) {
    internal let Location string = location
    internal let Value JsonElement = value
    internal let Current bool = current
    internal let Created DateTime = Directory.GetCreationTimeUtc(location)
    internal let Modified DateTime = File.GetLastWriteTimeUtc(Path.Combine(location, "run.json"))
    internal var Number int32 = RunStorage.Number(
        location,
        RunStorage.Prefix(J.Text(value, "repo"), J.Number(value, "issue"))
    )

    internal prop Issue int32 -> J.Number(Value, "issue")

    internal prop Name string -> Issue.ToString() + "-" + Number.ToString()

    internal prop Next string -> (Text("state") == "claim_pending" || Text("state") == "claimed") &&
        Text("source") == "tokate" ? "work":
    J.Number(Value, "pr") > 0 ? "checks":
    Text("state") == "generated" || Text("state") == "incomplete_generated" ? "submit": ""

    internal func Text(key string) string -> J.Text(Value, key)

    internal func Pull(repo string, pr int32) bool -> J.Number(Value, "pr") == pr && String.Equals(
        Text("repo"),
        repo,
        StringComparison.OrdinalIgnoreCase
    )

    internal func Age() string {
        let minutes = Math.Max(0, Convert.ToInt32(Math.Floor((DateTime.UtcNow - Modified).TotalMinutes)))
        return minutes < 60 ? minutes.ToString() + "m": minutes < 1440 ? (minutes / 60).ToString() + "h":
        (minutes / 1440).ToString() + "d"
    }

    internal func Matches(repo string, issue int32) bool -> Issue == issue && String.Equals(
        Text("repo"),
        repo,
        StringComparison.OrdinalIgnoreCase
    )

    internal func Summary() Dictionary[string, Object?] -> map[string, Object?]{
        "run": Location,
        "name": Text("repo") + "#" + Name,
        "storage": Current ? "current": "previous",
        "id": Text("id"),
        "repo": Text("repo"),
        "issue": Issue,
        "number": Number,
        "donor": Text("donor"),
        "model": Text("model"),
        "state": Text("state"),
        "pr": J.Number(Value, "pr"),
        "modified": Modified.ToString("yyyy-MM-ddTHH:mm:ssZ")
    }
}

internal class SavedRuns {
    internal let Rows List[SavedRun] = List[SavedRun]()
    internal var Skipped int32
    internal let SkippedEntries List[Object?] = List[Object?]()
    internal var Truncated bool

    shared {
        internal func Summary(
            rows List[SavedRun],
            skipped int32,
            truncated bool = false,
            skippedEntries List[Object?]? = nil
        ) Dictionary[string, Object?] {
            let items = List[Object?]()
            for row in rows {
                if items.Count == 128 {
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
    }

    internal init(roots[]string, limit int32 = Int32.MaxValue, listingRepo string? = nil) {
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
                        let value = RequestData.FileData(Path.Combine(directory, "run.json"), 1024 * 1024)
                        reason = "Invalid repository or excessive saved metadata."
                        RepositoryIdentity.Repo(J.Text(value, "repo"))
                        for key in[]string{"id", "repo", "donor", "model", "state"} {
                            if J.Text(value, key).Length > 256 {
                                throw Exception("Saved contribution metadata is too long")
                            }
                        }
                        if J.Number(value, "version") != 2 || J.Number(value, "issue") < 1 || J.Text(
                            value,
                            "state"
                        ) == "" {
                            reason = "Unsupported version or incomplete saved contribution."
                            throw Exception("Unsupported or incomplete saved contribution")
                        }
                        let row = SavedRun(directory, value, root == RunStorage.Root())
                        Rows.Add(row)
                        if row.Number == 0 {
                            legacy.Add(row)
                        }
                    } catch (error Exception) {
                        Skipped++
                        if SkippedEntries.Count < 128 {
                            SkippedEntries.Add(map[string, Object?]{"run": directory, "reason": reason})
                        } else {
                            Truncated = true
                        }
                    }
                }
            } catch (error Exception) {
                Skipped++
                if SkippedEntries.Count < 128 {
                    SkippedEntries.Add(map[string, Object?]{"run": root, "reason": "Unsafe or unreadable run storage."})
                } else {
                    Truncated = true
                }
            }
        }
        for row in legacy {
            var number int32 = 1
            for other in legacy {
                if other.Matches(row.Text("repo"), row.Issue) &&
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
            (a, b) -> !a.Matches(b.Text("repo"), b.Issue) ?
            StringComparer.OrdinalIgnoreCase.Compare(
                a.Text("repo") + "#" + a.Issue.ToString("D10"),
                b.Text("repo") + "#" + b.Issue.ToString("D10")
            ): a.Number != b.Number ? a
                .Number
                .CompareTo(b.Number): String.CompareOrdinal(a.Location, b.Location)
        )
        if listingRepo != nil {
            Rows.Sort(
                (a, b) -> {
                    let current = String.Equals(b.Text("repo"), listingRepo, StringComparison.OrdinalIgnoreCase)
                        .CompareTo(String.Equals(a.Text("repo"), listingRepo, StringComparison.OrdinalIgnoreCase))
                    let newest = b.Modified.CompareTo(a.Modified)
                    return current != 0 ? current: newest != 0 ? newest: String.CompareOrdinal(a.Location, b.Location)
                }
            )
        }
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
