package Tokate

import System
import System.Collections.Generic
import System.Text.Json

internal class CommitChecks {
    shared {
        internal func Read(repo string, head string, observed List[Object]? = nil) JsonElement {
            let rows = observed ?? List[Object]()
            let prefix = "repos/" + repo + "/commits/" + head

            for kind in[]string{"check-runs", "status"} {
                var page int32 = 1
                var inspected int32

                while page <= GitHub.PageCountLimit {
                    let response = GitHub.Api(
                        prefix + "/" + kind + "?" + GitHub.PageSizeParameter + "&page=" + page.ToString()
                    )

                    if kind == "status" && J.Get(response, "sha").ValueKind != JsonValueKind.Undefined && J.Text(
                        response,
                        "sha"
                    ) != head {
                        throw CliFailure("stale_approval", "Commit status belongs to a different head")
                    }

                    let items = J.Get(response, kind == "check-runs" ? "check_runs": "statuses")
                    if items.ValueKind != JsonValueKind.Array {
                        throw Exception("Cannot read complete commit checks")
                    }

                    let count = items.GetArrayLength()
                    inspected += count
                    if count > GitHub.PageSize {
                        throw Exception("Cannot read complete commit checks")
                    }

                    if kind == "check-runs" {
                        var total int32
                        if !J.Get(response, "total_count").TryGetInt32(out total) ||
                            total < inspected ||
                            (count < GitHub.PageSize && total != inspected) {
                            throw Exception("Cannot read complete commit checks")
                        }
                    }

                    for check in items.EnumerateArray() {
                        if kind == "check-runs" && J.Get(check, "head_sha")
                            .ValueKind != JsonValueKind.Undefined &&
                            J.Text(check, "head_sha") != head {
                            throw CliFailure("stale_approval", "Commit check belongs to a different head")
                        }

                        let state = if kind == "check-runs" {
                            if J.Text(check, "status") == "completed" {
                                J.Text(check, "conclusion")
                            } else {
                                J.Text(check, "status")
                            }
                        } else {
                            J.Text(check, "state")
                        }
                        let bucket = if state == "success" {
                            "pass"
                        } else if state == "failure" ||
                            state == "error" ||
                            state == "timed_out" ||
                            state == "action_required" ||
                            state == "startup_failure" {
                            "fail"
                        } else if state == "cancelled" {
                            "cancel"
                        } else if state == "skipped" || state == "neutral" {
                            "skipping"
                        } else {
                            "pending"
                        }

                        rows.Add(
                            map[string, Object?]{
                                "name": J.Text(check, kind == "check-runs" ? "name": "context"),
                                "state": state.ToUpperInvariant(),
                                "bucket": bucket,
                                "link": J.Text(check, kind == "check-runs" ? "html_url": "target_url"),
                                "workflow": ""
                            }
                        )
                    }

                    if count < GitHub.PageSize {
                        break
                    }

                    if page == GitHub.PageCountLimit {
                        throw Exception("Commit check inspection exceeded its bounded history")
                    }

                    page++
                }
            }

            return J.Parse(J.Write(rows))
        }
    }
}
