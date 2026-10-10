package TokateDesktop

import System
import System.Collections.Generic
import System.IO

/// Finds saved runs on disk. File access blocks, so call from a `go` worker.
class RunStore {
    shared {
        /// Run directories under the XDG state home and the default state home, remembered run first.
        /// Symbolic links are skipped.
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
                paths.Sort(StringComparer.Ordinal)
                for directory in paths {
                    if DirectoryInfo(directory).LinkTarget == nil && seen.Add(directory) {
                        result.Add(directory)
                    }
                }
            }
            return result.ToArray()
        }

        /// The saved claim file inside a run directory.
        func ClaimFile(run string) string -> Path.Combine(run, "run.json")

        /// The claim request identity saved when the run was claimed.
        func ClaimId(run string) string -> RunCodec.ClaimId(Json.ParseFile(ClaimFile(run)))

        func Exists(path string) bool -> File.Exists(path)
    }
}
