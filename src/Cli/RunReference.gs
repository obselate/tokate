package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Linq
import System.Text.Json

internal class RunReference {
    shared {
        private const LabelColumnWidth int32 = 7

        internal func Status(options Args) {
            let failure = ContributionStatus.Run(options)

            if !PublicOutput.Enabled {
                PrintStatus(J.Parse(J.Write(PublicOutput.ResultData)), options.Get("issue") == "")
            }

            if let error = failure {
                throw error
            }
        }

        internal func PrintStatus(value JsonElement, repository bool = false) {
            let repo = J.Text(value, "repo")
            let work = J.Get(value, "work")

            if work.ValueKind != JsonValueKind.Array {
                var next = Action(J.Get(value, "next"))

                for action in PublicOutput.Actions {
                    if action.Length > 1 && action[1] != "status" {
                        next = Terminal.Hint(action)
                        break
                    }
                }

                let issue = J.Get(value, "issue").ToString()
                let correction = J.Get(value, "correction")
                var state = J.Text(value, "outcome") != "" ? J.Text(value, "outcome"): J.Text(value, "state")
                var reason = J.Text(J.Get(value, "error"), "message")

                if J.Text(correction, "state") != "" {
                    state += ", correction " + J.Text(correction, "state")
                    reason = reason == "" ? J.Text(J.Get(correction, "error"), "message"): reason
                }

                Table(
                    repo == "" ? "": repo + (issue == "" ? "": "#" + issue),
                    state + (reason == "" ? "": ": " + reason),
                    J.Text(value, "pr_url"),
                    next
                )
                let checkout = J.Text(J.Get(value, "artifacts"), "checkout")
                if checkout != "" {
                    Cell("Path", checkout, "default")
                }
                return
            }

            let observed = J.Text(value, "remote_status") == "observed"

            if repository {
                Repository(value, J.Items(work), observed)
                return
            }

            for row in J.Items(work) {
                let drafts = J.Items(J.Get(row, "drafts"))
                Table(
                    repo + "#" + J.Number(row, "issue").ToString(),
                    J.Text(row, "state"),
                    drafts.Count == 0 ? "": J.Text(drafts[drafts.Count - 1], "url"),
                    Action(J.Get(J.Count(work) == 1 || !observed ? value: row, "next"))
                )
            }

            if J.Count(work) == 0 {
                Table(
                    repo,
                    observed ? "no_work_observed": J.Text(value, "remote_status"),
                    "",
                    Action(J.Get(value, "next"))
                )
            }
        }

        private func Repository(value JsonElement, work List[JsonElement], observed bool) {
            if !observed || work.Count == 0 {
                Cell("State", observed ? "no_work_observed": J.Text(value, "remote_status"), "yellow")
            }

            if !observed || work.Count == 0 || J.Count(J.Get(value, "pending_requests")) > 0 {
                Cell("Next", Action(J.Get(value, "next")), "default")
            }

            if work.Count > 0 {
                let viewer = J.Get(value, "viewer")
                let me = J.Get(viewer, "actor").ToString()
                let table = List[[]string]{[]string{"ISSUE", "TITLE", "STATE", "YOU"}}

                for task in work {
                    let next = J.Get(task, "next")
                    let role = J.Text(next, "role")
                    let reservation = J.Get(task, "reservation")
                    let holder = J.Bool(reservation, "expired") || J.Text(reservation, "status") == "released" ? "":
                    J.Get(reservation, "actor").ToString()
                    let eligible = J.Text(task, "eligibility_status") == "eligible"
                    let mine = role == "donor" ? (
                        holder == "" ? J.Text(viewer, "role") == "donor" || eligible: holder == me
                    ):
                    role == J.Text(viewer, "role")
                    table.Add(
                        []string{
                            "#" + J.Number(task, "issue").ToString(),
                            J.Text(task, "title"),
                            J.Text(task, "state"),
                            J.Text(viewer, "role") == "" ? "?": mine ? "yes": "no"
                        }
                    )
                    table.Add([]string{"Next: " + Action(next)})
                }

                Terminal.Table(table, fit: 1)
            }

            if J.Bool(value, "truncated") {
                Terminal.Message("Bounded snapshot: some data was omitted.", "default")
            }
        }

        private func Action(next JsonElement) string {
            let command = Terminal.Hint(J.Items(J.Get(next, "command")).ConvertAll(word -> word.ToString()).ToArray())
            return command == "" ? J.Text(next, "action"): command
        }

        private func Table(issue string, state string, pr string, next string) {
            Cell("Issue", issue, "default")
            Cell("State", state, state.Contains("failed") ? "red": "yellow")
            Cell("PR", pr, "default")
            Cell("Next", next, "default")
        }

        private func Cell(label string, value string, color string) -> Terminal.Line(
            Output.Clean(label.PadRight(LabelColumnWidth) + (value == "" ? "none": value)).Replace('\n', ' '),
            color,
            false
        )

        private var Here string? = nil

        internal func Locate() string {
            if Here == nil {
                Here = ""
                try {
                    Here = RepositoryInput.Local()
                } catch (error Exception) { }
            }

            return Here ?? ""
        }

        internal func Label(row SavedRun, saved SavedRuns, pull bool = false) string {
            let repo = row.Run.Repo
            let name = repo.Substring(repo.IndexOf('/') + 1)
            let unique = saved.Rows.TrueForAll(other -> !Named(other, name) || Named(other, repo))
            let prefix = String.Equals(repo, Here, StringComparison.OrdinalIgnoreCase) ? "": (unique ? name: repo) + "#"

            if pull {
                return prefix + row.Run.Pr.ToString()
            }

            let picked = SavedRuns.Pick(saved.For(repo, row.Issue))?.Location == row.Location
            return prefix + row.Issue.ToString() + (picked ? "": "-" + row.Number.ToString())
        }

        private func Named(row SavedRun, name string) bool -> ("/" + row.Run.Repo).EndsWith(
            "/" + name,
            StringComparison.OrdinalIgnoreCase
        )

        internal func Repo(name string) string {
            let rows = SavedRuns(RunStorage.Roots()).Rows.FindAll(row -> Named(row, name))

            if rows.Count == 0 || !rows.TrueForAll(row -> Named(row, rows[0].Run.Repo)) {
                throw Exception("Saved runs do not identify " + name + "; name OWNER/REPO#N")
            }

            return rows[0].Run.Repo
        }

        internal func Short(actions List[[]string], full bool) List[[]string] {
            if !actions.Exists(action -> Array.IndexOf(action, "--run") > 0) {
                return actions
            }

            let saved = SavedRuns(RunStorage.Roots())
            return actions.ConvertAll(action -> Short(action, full, saved))
        }

        private func Short(action[]string, full bool, saved SavedRuns)[]string {
            let index = Array.IndexOf(action, "--run")

            if index < 1 || action[0] != "tokate" || !Cli.Find(action[1]).Runs {
                return action
            }

            let row = saved.Rows.Find(other -> other.Location == action[index + 1])

            if row == nil || row.Issue < 1 || saved.Rows.FindAll(other -> other.Name == row.Name).Count > 1 {
                return action
            }

            let words = List[string](action)
            words.RemoveRange(index, 2)
            words.Insert(2, full ? row.Name: Label(row, saved, action[1] == "checks"))
            return words.ToArray()
        }

        internal func Resolve(args Args) {
            let command = Cli.Find(args.Command)
            let named = args.Get("attempt") != ""
            let pull = args.Command == "checks" && args.Get("pr") != ""
            let optional = pull || (args.Command == "work" && !named)

            if args.Run != "" || args.Get("run") != "" ||
                (args.Get("issue") == "" && !pull) ||
                (!command.RunTarget && !named && !optional) {
                return
            }

            if args.Command == "work" && !named {
                for key in args.Values.Keys {
                    if key != "--repo" && key != "--issue" && key != "--runs" && command.ConflictsWithRun(
                        key.Substring(2)
                    ) {
                        return
                    }
                }
            }

            let here = Locate()
            let repo = args.Get("repo") != "" ? args.Get("repo"): here != "" || optional ? here: RepositoryInput.Local()

            if repo == "" {
                return
            }

            let saved = SavedRuns(args.Get("runs") != "" ? []string{RunStorage.Store(args)}: RunStorage.Roots())
            let rows = List[SavedRun]()

            for row in saved.Rows {
                let match = pull ? row.Pull(repo, args.Number("pr")): row.Matches(repo, args.Number("issue")) &&
                    (!named || row.Number == args.Number("attempt"))
                if match {
                    rows.Add(row)
                }
            }

            if optional && (rows.Count == 0 || (pull && rows.Count > 1)) {
                return
            }

            let name = repo + "#" + args.Get("issue") + (named ? "-" + args.Get("attempt"): "")

            if rows.Count == 0 {
                throw Exception("No saved run " + name + ". List saved runs with tokate status")
            }

            if named && rows.Count > 1 {
                throw Exception("Saved run name " + name + " is not unique; use --run DIR")
            }

            let row = SavedRuns.Pick(rows) ??
                throw Exception(
                "Saved run name " + name + " is ambiguous: " + String.Join(
                    ", ",
                    rows.FindAll(other -> other.Run.State != "failed").ConvertAll(other -> Label(other, saved))
                ) +
                    ". Name one attempt"
            )

            args.Run = Label(row, saved)

            if !named {
                Terminal.Message("Run " + args.Run + ": " + row.Run.State + ", " + row.Age() + " old", "cyan", true)
            }

            for key in[]string{"--repo", "--issue", "--attempt", "--pr", "--runs"} {
                args.Values.Remove(key)
            }

            args.Values["--run"] = row.Location
        }

        internal func Print(args Args) {
            let repo = Locate()
            let saved = SavedRuns(RunStorage.Roots())
            let rows = saved
                .Rows
                .Where(row -> repo == "" || String.Equals(row.Run.Repo, repo, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(row -> row.Modified)
                .ThenBy(row -> row.Location, StringComparer.Ordinal)
                .ToList()
            SavedRuns.Outcomes(rows)
            let shown = args.Get("all") == "true" ? rows: rows.FindAll(row -> !row.Finished)
            let hidden = rows.Count - shown.Count

            if PublicOutput.Enabled {
                let data = SavedRuns.Summary(shown, saved.Skipped, saved.Truncated, saved.SkippedEntries)
                data["hidden"] = hidden
                PublicOutput.ResultData = data
                PublicOutput.Truncated = saved.Truncated || shown.Count > SavedRuns.SummaryCountLimit
                return
            }

            if shown.Count == 0 {
                Terminal.Message("No saved runs.", "default")
            } else {
                Terminal.Runs(shown, saved)
            }

            if hidden > 0 {
                Terminal.Message(
                    hidden.ToString() + " finished runs hidden. Show them with tokate status --all.",
                    "default"
                )
            }
        }
    }
}
