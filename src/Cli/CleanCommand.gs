package Tokate

import System
import System.Collections.Generic
import System.IO

internal class CleanCommand {
    shared {
        internal func Validate(args Args) {
            if args.Get("ignored") != "" && args.Words.Count != 1 {
                throw CliFailure(
                    "invalid_arguments",
                    "Use tokate clean RUN --ignored DIR to select one ignored directory."
                )
            }
        }

        private func Resolve(name string, saved SavedRuns) SavedRun {
            var path = ""

            if Directory.Exists(name) {
                path = LocalPaths.DirectoryPath(name)
            } else {
                let reference = Args([]string{"status", name})
                Cli.Validate(reference)
                path = Path.GetFullPath(reference.Need("run"))
            }

            let row = saved.Rows.Find(other -> other.Location == path) ?? SavedRuns(
                []string{Path.GetDirectoryName(path) ?? ""}
            )
                .Rows
                .Find(other -> other.Location == path)

            return row ?? throw CliFailure("invalid_state", "Cannot identify saved run at " + path)
        }

        internal func Run(args Args) int32 {
            let saved = SavedRuns(RunStorage.Roots())
            let selected = List[CleanupTarget]()
            let candidates = List[CleanupTarget]()
            let ignored = List[CleanupTarget]()
            let kept = List[Object?](saved.SkippedEntries)
            let rows = List[SavedRun]()
            let selecting = args.Words.Count > 0
            var refused = false
            var total int64

            for name in args.Words {
                let row = Resolve(name, saved)

                if rows.Exists(other -> other.Location == row.Location) {
                    throw CliFailure("invalid_arguments", "Run selected more than once: " + row.Location)
                }

                rows.Add(row)
            }

            for row in selecting ? rows: saved.Rows {
                var reason = args.Get("ignored") != "" ? (row.Busy() ? "Run is in use.": ""): CleanupEligibility.Reason(
                    row
                )

                if reason == "" {
                    if args.Get("ignored") != "" {
                        selected.AddRange(CleanupPaths.Ignored(row, args.Get("ignored")))
                    } else {
                        try {
                            let target = CleanupTarget(row, row.Location, false)

                            candidates.Add(target)

                            if selecting {
                                selected.Add(target)
                            } else {
                                total += target.Bytes
                            }
                        } catch (error Exception) when error is IOException || error is UnauthorizedAccessException {
                            reason = "Cannot measure run: " + error.Message
                        }
                    }
                }

                if reason != "" {
                    refused = selecting
                    kept.Add(map[string, Object?]{"run": row.Location, "reason": reason})

                    if !selecting {
                        AddIgnored(row, ignored, kept)
                    }
                }
            }

            for target in selected {
                total += target.Bytes
            }

            if !selecting {
                for target in ignored {
                    total += target.Bytes
                }
            }

            let preview = map[string, Object?]{
                "candidates": candidates.ConvertAll(target -> target.Summary()),
                "kept": kept,
                "ignored_directories": ignored.ConvertAll(target -> target.Summary()),
                "selected": selected.ConvertAll(target -> target.Summary()),
                "total_bytes": total,
                "applied": false
            }

            PublicOutput.ResultData = preview
            Print(candidates, kept, ignored, selected, total)

            if refused {
                throw CliFailure(
                    "invalid_state",
                    "Selected runs must be kept for the reasons in the preview. Nothing deleted."
                )
            }

            if !selecting {
                return 0
            }

            if !OwnerSetup.Confirm(
                args,
                "Delete exactly the selected paths? Whole-run removal ends amendment and recovery."
            ) {
                throw CliFailure("confirmation_required", "Pass --yes to apply the preview. Nothing changed.")
            }

            Delete(selected)
            preview["applied"] = true
            Terminal.Message("Deleted the selected paths.")

            return 0
        }

        private func AddIgnored(row SavedRun, ignored List[CleanupTarget], kept List[Object?]) {
            try {
                for target in CleanupPaths.Ignored(row) {
                    ignored.Add(target)
                }
            } catch (error Exception) when error is CliFailure ||
                error is IOException ||
                error is UnauthorizedAccessException ||
                error.GetType() == typeof(Exception) {
                kept.Add(
                    map[string, Object?]{
                        "run": row.Location,
                        "reason": "Cannot inspect ignored directories: " + error.Message
                    }
                )
            }
        }

        private func Print(
            candidates List[CleanupTarget],
            kept List[Object?],
            ignored List[CleanupTarget],
            selected List[CleanupTarget],
            total int64
        ) {
            for group in[]List[CleanupTarget]{candidates, ignored} {
                Terminal.Message(
                    group == candidates ? "Candidate whole runs:": "Largest ignored directories in kept runs (not selected):"
                )

                for target in group {
                    Terminal.Message("  " + target.Path + "  " + target.Bytes.ToString() + " bytes")
                }
            }

            for value in kept {
                if value is Dictionary[string, Object?] {
                    Terminal.Message("Keep " + value["run"]?.ToString() + ": " + value["reason"]?.ToString())
                }
            }

            Terminal.Message("Selected paths:")

            for target in selected {
                Terminal.Message("  " + target.Path + "  " + target.Bytes.ToString() + " bytes")
            }

            Terminal.Message("Total: " + total.ToString() + " bytes. Preview only until confirmed.")
        }

        private func Delete(targets List[CleanupTarget]) {
            let leases = List[FileStream]()

            try {
                for target in targets {
                    RunStorage.ControlPaths(target.Run.Location)
                    leases.Add(RunStorage.Lock(target.Run.Location))
                    let value = RequestData.FileData(
                        Path.Combine(target.Run.Location, "run.json"),
                        RunStorage.RunFileByteLimit
                    )

                    if !RequestData.Same(value, target.Run.Value) {
                        throw CliFailure("invalid_state", "Saved run changed. Preview it again: " + target.Run.Location)
                    }

                    let row = target.Run

                    if target.Ignored {
                        Verification.Validate(Path.Combine(row.Location, "checkout"))
                        CleanupPaths.ValidateIgnored(Path.Combine(row.Location, "checkout"), target.Path)
                    } else {
                        let reason = CleanupEligibility.Reason(row, leased: true)

                        if reason != "" {
                            throw CliFailure("invalid_state", "Keep " + row.Location + ": " + reason)
                        }
                    }

                    if RunStorage.Size(target.Path) != target.Bytes {
                        throw CliFailure("invalid_state", "Selected path changed. Preview it again: " + target.Path)
                    }
                }

                for target in targets {
                    CleanupPaths.Delete(target.Path)
                }
            } catch (error Exception) when error is IOException || error is UnauthorizedAccessException {
                throw CliFailure("command_failed", "Cleanup failed: " + error.Message)
            } finally {
                for lease in leases {
                    lease.Dispose()
                }
            }
        }
    }
}
