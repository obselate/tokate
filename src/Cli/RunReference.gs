package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Linq

internal class RunReference {
    shared {
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

        internal func Recent(rows List[SavedRun]) List[SavedRun] -> rows.GetRange(
            Math.Max(0, rows.Count - 16),
            Math.Min(16, rows.Count)
        )

        internal func Pick(rows List[SavedRun]) SavedRun? {
            let active = rows.FindAll(row -> row.Text("state") != "failed")
            return active.Count > 1 ? nil: active.Count == 1 ? active[0]: rows.Count > 0 ? rows[rows.Count - 1]: nil
        }

        internal func Label(row SavedRun, saved SavedRuns, pull bool = false) string {
            let repo = row.Text("repo")
            let name = repo.Substring(repo.IndexOf('/') + 1)
            let unique = saved.Rows.TrueForAll(other -> !Named(other, name) || Named(other, repo))
            let prefix = String.Equals(repo, Here, StringComparison.OrdinalIgnoreCase) ? "": (unique ? name: repo) + "#"

            if pull {
                return prefix + J.Number(row.Value, "pr").ToString()
            }

            let picked = Pick(saved.For(repo, row.Issue))?.Location == row.Location
            return prefix + row.Issue.ToString() + (picked ? "": "-" + row.Number.ToString())
        }

        private func Named(row SavedRun, name string) bool -> ("/" + row.Text("repo")).EndsWith(
            "/" + name,
            StringComparison.OrdinalIgnoreCase
        )

        internal func Repo(name string) string {
            let rows = SavedRuns(RunStorage.Roots()).Rows.FindAll(row -> Named(row, name))

            if rows.Count == 0 || !rows.TrueForAll(row -> Named(row, rows[0].Text("repo"))) {
                throw Exception("Saved runs do not identify " + name + "; name OWNER/REPO#N")
            }

            return rows[0].Text("repo")
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

            if row == nil || saved.Rows.FindAll(other -> other.Name == row.Name).Count > 1 {
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

            let row = Pick(rows) ??
                throw Exception(
                "Saved run name " + name + " is ambiguous: " + String.Join(
                    ", ",
                    rows.FindAll(other -> other.Text("state") != "failed").ConvertAll(other -> Label(other, saved))
                ) +
                    ". Name one attempt"
            )

            args.Run = Label(row, saved)

            if !named {
                Terminal.Message("Run " + args.Run + ": " + row.Text("state") + ", " + row.Age() + " old", "cyan", true)
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
                Terminal.Runs(shown, saved)
            }

            if hidden > 0 {
                Terminal.Message(
                    hidden.ToString() + " finished runs hidden. Show them with tokate status --all.",
                    "default"
                )
            }
        }

        internal func Outcomes(rows List[SavedRun]) {
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
}
