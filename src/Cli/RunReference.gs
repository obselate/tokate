package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Linq

internal class RunReference {
    shared {
        internal func Label(args Args, row SavedRun) string -> args.Words.Count > 0 && !args.Words[0].Contains("/") ?
        row.Name: row.Text("repo") + "#" + row.Name

        internal func Recent(rows List[SavedRun]) List[SavedRun] -> rows.GetRange(
            Math.Max(0, rows.Count - 16),
            Math.Min(16, rows.Count)
        )

        internal func Resolve(args Args) {
            let command = Cli.Find(args.Command)
            let named = args.Get("attempt") != ""
            let pull = args.Command == "checks" && args.Get("pr") != ""
            let optional = pull || (args.Command == "work" && !named)

            if args.Run != "" || args.Get("run") != "" ||
                (args.Get("issue") == "" && !pull) ||
                (command.Target != "run" && !named && !optional) {
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

            var repo = args.Get("repo")

            if repo == "" {
                try {
                    repo = RepositoryInput.Local()
                } catch (error Exception) {
                    if optional {
                        return
                    }

                    throw error
                }
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

            let row = rows[rows.Count - 1]

            args.Run = Label(args, row)

            if !named {
                args.Attempts = pull ? rows: saved.For(repo, row.Issue)
                Terminal.Message("Run " + args.Run + ": " + row.Text("state") + ", " + row.Age() + " old", "cyan", true)
            }

            for key in[]string{"--repo", "--issue", "--attempt", "--pr", "--runs"} {
                args.Values.Remove(key)
            }

            args.Values["--run"] = row.Location
        }

        internal func Name(args Args, directory string) string {
            if args.Words.Count == 0 || Array.IndexOf(RunStorage.Roots(), Path.GetDirectoryName(directory) ?? "") < 0 {
                return ""
            }

            let saved = SavedRuns(RunStorage.Roots())

            for row in saved.Rows {
                if row.Location != directory {
                    continue
                }

                var same int32

                for other in saved.For(row.Text("repo"), row.Issue) {
                    if other.Number == row.Number {
                        same++
                    }
                }

                return same == 1 ? Label(args, row): ""
            }

            return ""
        }

        internal func Print(args Args) {
            var repo = ""
            try {
                repo = RepositoryInput.Local()
            } catch (error Exception) { }

            let saved = SavedRuns(RunStorage.Roots())
            let rows = saved
                .Rows
                .Where(row -> repo == "" || String.Equals(row.Text("repo"), repo, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(row -> row.Modified)
                .ThenBy(row -> row.Location, StringComparer.Ordinal)
                .ToList()
            Outcomes(rows)
            let shown = args.Get("all") == "true" ? rows: rows.FindAll(row -> !row.Finished)
            let hidden = rows.Count - shown.Count

            if PublicOutput.Enabled {
                let data = SavedRuns.Summary(shown, saved.Skipped, saved.Truncated, saved.SkippedEntries)
                data["hidden"] = hidden
                PublicOutput.ResultData = data
                PublicOutput.Truncated = saved.Truncated || shown.Count > 128
                return
            }

            if shown.Count == 0 {
                Terminal.Message("No saved runs.", "default")
            } else {
                Terminal.Runs(args, shown, short: repo != "")
            }

            if hidden > 0 {
                Terminal.Message(
                    hidden.ToString() + " finished runs hidden. Show them with tokate status --all.",
                    "default"
                )
            }
        }

        private func Outcomes(rows List[SavedRun]) {
            let pulls = rows.Where(row -> J.Number(row.Value, "pr") > 0 && !row.Finished).Take(100).ToList()

            if pulls.Count == 0 {
                return
            }

            var query = ""

            for i in 0 ... pulls.Count {
                let repo = pulls[i].Text("repo").Split('/')
                query += "p" + i.ToString() + ":repository(owner:\"" + repo[0] + "\",name:\"" + repo[1] + "\")"
                query += "{pullRequest(number:" + J.Number(pulls[i].Value, "pr").ToString() + "){state}}"
            }

            try {
                let data = J.Get(GitHub.Api("graphql", map[string, Object?]{"query": "query{" + query + "}"}), "data")

                for i in 0 ... pulls.Count {
                    let state = J.Text(J.Get(J.Get(data, "p" + i.ToString()), "pullRequest"), "state")

                    if state == "MERGED" || state == "CLOSED" {
                        pulls[i].Outcome = state.ToLowerInvariant()
                    }
                }
            } catch (error Exception) { }
        }
    }
}
