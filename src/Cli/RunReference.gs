package Tokate

import System
import System.Collections.Generic

internal class RunReference {
    shared {
        private var Here string = ""

        internal func Locate() {
            try {
                Here = RepositoryInput.Local()
            } catch (error Exception) { }
        }

        internal func Recent(rows List[SavedRun]) List[SavedRun] -> rows.GetRange(
            Math.Max(0, rows.Count - 16),
            Math.Min(16, rows.Count)
        )

        internal func Pick(rows List[SavedRun]) SavedRun? {
            let active = rows.FindAll(row -> row.Text("state") != "failed")
            return active.Count > 1 ? nil: active.Count == 1 ? active[0]: rows.Count > 0 ? rows[rows.Count - 1]: nil
        }

        internal func Label(row SavedRun, saved SavedRuns) string {
            let repo = row.Text("repo")
            let name = repo.Substring(repo.IndexOf('/') + 1)
            let unique = saved.Rows.TrueForAll(other -> !Named(other, name) || other.Text("repo") == repo)
            let prefix = String.Equals(repo, Here, StringComparison.OrdinalIgnoreCase) ? "": (unique ? name: repo) + "#"
            let suffix = Pick(saved.For(repo, row.Issue)) == row ? "": "-" + row.Number.ToString()
            return prefix + row.Issue.ToString() + suffix
        }

        private func Named(row SavedRun, name string) bool -> row.Text("repo").EndsWith(
            "/" + name,
            StringComparison.OrdinalIgnoreCase
        )

        internal func Repo(name string) string {
            let rows = SavedRuns(RunStorage.Roots()).Rows.FindAll(row -> Named(row, name))

            if rows.Count == 0 || !rows.TrueForAll(row -> row.Text("repo") == rows[0].Text("repo")) {
                throw Exception("Saved runs do not identify " + name + "; name OWNER/REPO#N")
            }

            return rows[0].Text("repo")
        }

        internal func Short(action[]string)[]string {
            let index = Array.IndexOf(action, "--run")

            if index < 1 || action[0] != "tokate" || !Cli.Find(action[1]).Runs {
                return action
            }

            let saved = SavedRuns(RunStorage.Roots())
            let row = saved.Rows.Find(other -> other.Location == action[index + 1])

            if row == nil ||
                saved
                .For(row.Text("repo"), row.Issue)
                .FindAll(other -> other.Number == row.Number)
                .Count > 1 {
                return action
            }

            let words = List[string](action)
            words.RemoveRange(index, 2)
            words.Insert(2, Label(row, saved))
            return words.ToArray()
        }

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
                throw Exception("No saved run " + name + ". List saved runs with tokate runs")
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
            let saved = SavedRuns(RunStorage.Roots(), listingRepo: Here)
            let repo = args.Get("issue") != "" && args.Get("repo") == "" ? RepositoryInput.Local(): args.Get("repo")
            let rows = List[SavedRun]()

            for row in saved.Rows {
                if (repo == "" || String.Equals(row.Text("repo"), repo, StringComparison.OrdinalIgnoreCase)) &&
                    (args.Get("issue") == "" || row.Issue == args.Number("issue")) {
                    rows.Add(row)
                }
            }

            if PublicOutput.Enabled {
                PublicOutput.ResultData = SavedRuns.Summary(rows, saved.Skipped, saved.Truncated, saved.SkippedEntries)
                PublicOutput.Truncated = saved.Truncated || rows.Count > 128
            } else if rows.Count == 0 {
                Terminal.Message("No saved runs.", "default")
            } else {
                Terminal.Runs(rows)
            }
        }
    }
}
