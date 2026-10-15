package TokateDesktop

import System
import System.Collections.Generic
import System.IO

/// Finds saved runs on disk. File access blocks, so call from a `go` worker.
class RunStore {
    shared {
        private func RepositoryFile() string {
            let configured = Environment.GetEnvironmentVariable("XDG_STATE_HOME") ?? ""
            let home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local/state")
            return Path.Combine(Path.IsPathFullyQualified(configured) ? configured: home, "tokate-desktop", "repositories.json")
        }

        func ReadRepositories() []string {
            try {
                return Json.Strings(Json.ParseFile(RepositoryFile()))
            } catch (error Exception) {
                return []string{}
            }
        }

        func RememberRepository(repository string) {
            try {
                let recent = List[string]{repository}
                for saved in ReadRepositories() {
                    if !String.Equals(saved, repository, StringComparison.OrdinalIgnoreCase) && recent.Count < 6 {
                        recent.Add(saved)
                    }
                }
                Directory.CreateDirectory(Path.GetDirectoryName(RepositoryFile())!!)
                File.WriteAllText(RepositoryFile(), Json.StringArray(recent.ToArray()))
            } catch (error Exception) {
            }
        }

        func SavedRepositories() []string {
            let result = HashSet[string](StringComparer.OrdinalIgnoreCase)
            for directory in Discover("") {
                try {
                    let repository = Json.Text(Json.ParseFile(ClaimFile(directory)), "repo")
                    if repository != "" {
                        result.Add(repository)
                    }
                } catch (error Exception) {
                }
            }
            return List[string](result).ToArray()
        }

        /// Run directories under the XDG state home and the default state home, remembered run first, then
        /// the most recently changed first. Symbolic links are skipped.
        func Discover(remembered string) []string {
            let previous = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local/state")
            let configured = Environment.GetEnvironmentVariable("XDG_STATE_HOME") ?? ""
            let current = Path.IsPathFullyQualified(configured) ? configured: previous
            let seen = HashSet[string](StringComparer.Ordinal)
            let result = List[string]()
            if remembered != "" {
                result.Add(remembered)
                seen.Add(remembered)
            }
            for storage in current == previous ? []string{current}: []string{current, previous} {
                let root = Path.Combine(storage, "tokate/runs")
                if !Directory.Exists(root) || DirectoryInfo(root).LinkTarget != nil {
                    continue
                }
                let paths = List[string](Directory.EnumerateDirectories(root))
                let times = Dictionary[string, DateTime]()
                for directory in paths {
                    times[directory] = Changed(directory)
                }
                paths.Sort(
                    (a string, b string) -> times[a] == times[b] ? String.CompareOrdinal(a, b): times[b].CompareTo(times[a])
                )
                for directory in paths {
                    if DirectoryInfo(directory).LinkTarget == nil && seen.Add(directory) {
                        result.Add(directory)
                    }
                }
            }
            return result.ToArray()
        }

        /// When the run directory last changed.
        func Changed(run string) DateTime -> Directory.GetLastWriteTimeUtc(run)

        /// The saved claim file inside a run directory.
        func ClaimFile(run string) string -> Path.Combine(run, "run.json")

        /// The claim request identity saved when the run was claimed.
        func ClaimId(run string) string -> RunCodec.ClaimId(Json.ParseFile(ClaimFile(run)))

        func Exists(path string) bool -> File.Exists(path)
        func Checkout(run Run) string {
            if !run.External {
                return run.Checkout
            }
            let saved = Json.ParseFile(ClaimFile(run.Path))
            return Json.Get(saved, "reconciliation").ValueKind == System.Text.Json.JsonValueKind.Undefined &&
                Json.Get(saved, "synchronizations").ValueKind == System.Text.Json.JsonValueKind.Undefined ?
                Path.Combine(run.Path, "coding"): run.Checkout
        }

        /// The commit at HEAD of a saved checkout, when its files differ from `published`.
        func Correction(checkout string, published string) CheckoutHead {
            if Directory.Exists(checkout) && published != "" {
                let head = ProcessRunner().Run(CommandStart("git", []string{"-C", checkout, "log", "-1", "--format=%H%n%s"}), 10)
                let lines = head.Output.Split('\n')
                if head.ExitCode == 0 && head.Error == "" && lines.Length > 1 {
                    let commit = lines[0].Trim()
                    let diff = ProcessRunner().Run(
                        CommandStart("git", []string{"-C", checkout, "diff", "--name-only", published, commit, "--"}),
                        10
                    )
                    let files = diff.Output.Split('\n', StringSplitOptions.RemoveEmptyEntries).Length
                    if diff.ExitCode == 0 && diff.Error == "" && files > 0 {
                        return CheckoutHead{Commit: commit, Subject: lines[1].Trim(), Files: files}
                    }
                }
            }
            return CheckoutHead{Commit: "", Subject: ""}
        }

        /// The public summary that the pull request has now: the one of the amendment that published
        /// `commit`, or the one of the donation.
        func Summary(run string, commit string) PublicSummary {
            let amended = Path.Combine(run, "amendments", commit, "run.json")
            try {
                return RunCodec.Summary(Json.ParseFile(commit != "" && File.Exists(amended) ? amended: ClaimFile(run)))
            } catch (error Exception) {
                return PublicSummary.Empty
            }
        }

        /// Why the amendment of `commit` failed, when Tokate saved that after `since`. Otherwise "".
        func AmendmentFailure(run string, commit string, since DateTime) string {
            let amended = Path.Combine(run, "amendments", commit, "run.json")
            let record = File.Exists(amended) ? amended: Path.Combine(run, "correction.json")
            try {
                return File.Exists(record) && File.GetLastWriteTimeUtc(record) >= since ?
                RunCodec.AmendmentFailure(Json.ParseFile(record)): ""
            } catch (error Exception) {
                return ""
            }
        }

        /// The request that finishes the amendment of `run` that waits for the coordinator. It repeats the
        /// command that Tokate gives. Tokate compares the summary and the tool declarations of that command
        /// with the saved amendment, so new files with the saved values replace the first files.
        func FinishAmendment(run Run, path string) CoordinatorRequest {
            let amended = Path.Combine(path, "amendments", run.Amending, "run.json")
            let record = Json.ParseFile(File.Exists(amended) ? amended: Path.Combine(path, "correction.json"))
            let tools = Json.Get(record, "tools")
            let files = WriteAmendment(Json.Summary(run.Amending, RunCodec.Summary(record)), Json.Items(tools).Length > 0 ? Json.Raw(tools): "")
            let arguments = List[string]()
            var seconds = 600
            for i in 1 ... run.Finish.Length {
                let option = run.Finish[i - 1]
                let value = run.Finish[i]
                if option == "--time" {
                    seconds = Int32.Parse(value.TrimEnd('s')) + 120
                }
                if value != "--json" {
                    arguments.Add(option == "--summary" ? SummaryFile(files): option == "--tools" ? ToolsFile(files): value)
                }
            }
            return CoordinatorRequest{
                Action: RunAction.Amend,
                Path: path,
                Repo: run.Repo,
                Issue: run.Issue,
                Head: run.Amending,
                Arguments: arguments.ToArray(),
                Seconds: seconds,
                Files: files,
                Since: DateTime.UtcNow,
            }
        }

        func SummaryFile(directory string) string -> Path.Combine(directory, "summary.json")

        func ToolsFile(directory string) string -> Path.Combine(directory, "tools.json")

        /// Writes the files that one amendment command reads to a new private directory and returns it.
        /// Empty `tools` writes no tool declarations.
        func WriteAmendment(summary string, tools string) string {
            let directory = Directory.CreateTempSubdirectory("tokate-amendment-").FullName
            File.WriteAllText(SummaryFile(directory), summary)
            if tools != "" {
                File.WriteAllText(ToolsFile(directory), tools)
            }
            return directory
        }

        func Remove(directory string) -> Directory.Delete(directory, true)
    }
}
