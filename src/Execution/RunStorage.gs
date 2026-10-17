package Tokate

import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Text.Json
import System.Text.RegularExpressions
import System.Threading

internal class RunStorage {
    shared {
        internal const RunFileByteLimit int32 = 1024 * 1024

        internal func Root() string -> Path.Combine(LocalPaths.StateDirectory(), "runs")

        internal func ControlPaths(directory string) {
            try {
                LocalPaths.DirectoryPath(directory)
            } catch (error Exception) when error is CliFailure ||
                error is IOException ||
                error is UnauthorizedAccessException {
                throw ExecutionFailure.Create("invalid_state", error.Message + "; saved run directory: " + directory)
            }

            for name in[]string{".lock", "run.json", "run.json.tmp", "claim.posting.json"} {
                ControlFile(directory, name)
            }
        }

        internal func ControlFile(directory string, name string) {
            let path = Path.Combine(directory, name)

            if FileInfo(path).LinkTarget != nil {
                Reject(directory)
            }

            if File.Exists(path) || Directory.Exists(path) {
                let status = [256]byte
                if RuntimeMetadataStat(-100, path, 256, 5, status) != 0 ||
                    (BitConverter.ToUInt32(status, 0) & 5) != 5 ||
                    (BitConverter.ToUInt16(status, 28) & 61440) != 32768 ||
                    BitConverter.ToUInt32(status, 16) != 1 {
                    Reject(directory)
                }
            }
        }

        internal func Lease(directory string) FileStream {
            ControlPaths(directory)
            let timer = Stopwatch.StartNew()
            var lease FileStream

            while true {
                try {
                    lease = Lock(directory)
                    break
                } catch (error IOException) when timer.ElapsedMilliseconds < 500 {
                    Thread.Sleep(20)
                }
            }
            try {
                Data.Migrate(directory)
                return lease
            } catch (error Exception) {
                lease.Dispose()
                throw error
            }
        }

        internal func Lock(directory string) FileStream -> File.Open(
            Path.Combine(directory, ".lock"),
            FileMode.OpenOrCreate,
            FileAccess.ReadWrite,
            FileShare.None
        )

        private func Reject(path string) {
            throw CliFailure(
                "invalid_state",
                "Preserved unidentified, dirty or divergent preparation at " +
                    path +
                    ". Inspect and move it aside explicitly, or use its original saved run; then use work --run DIR. No files or branches were replaced."
            )
        }

        internal func Store(args Args) string -> Path.GetFullPath(args.Get("runs", Root()))

        internal func Prefix(repo string, issue int32) string -> repo.Replace('/', '-').ToLowerInvariant() +
            "-" +
            issue.ToString() + "-"

        internal func Number(directory string, prefix string) int32 {
            let name = Path.GetFileName(directory)
            var number int32

            return name.StartsWith(prefix, StringComparison.Ordinal) && Regex.IsMatch(
                name.Substring(prefix.Length),
                "^[1-9][0-9]{0,8}\\z"
            ) &&
                Int32.TryParse(name.Substring(prefix.Length), out number) ? number: 0
        }

        internal func Allocate(root string, repo string, issue int32, id string, stopped Func[Data, bool]) string {
            let prefix = Prefix(repo, issue)
            var number int32
            let roots = List[string](Roots())
            roots.Add(root)

            for row in SavedRuns(roots.ToArray()).Rows {
                if row.Run.Attempt == id || J.Text(row.Run.ClaimRequest, "uuid") == id {
                    Output.Sink.RunDirectory = row.Location
                    if stopped(row.Run) {
                        throw ExecutionFailure.Create(
                            "invalid_state",
                            "Saved contribution already exists: " + row.Location + ". Run " + Output.Sink.Command(
                                []string{"tokate", "pause", "--run", row.Location}
                            ) +
                                ", then " +
                                Output
                                .Sink
                                .Command([]string{"tokate", "resume", "--run", row.Location}) +
                                ". Wait for each coordinator acceptance, then run " +
                                Output
                                .Sink
                                .Command([]string{"tokate", "status", "--run", row.Location, "--json"}) +
                                " for the continuation command. No files were overwritten."
                        )
                    }
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "Saved contribution already exists; inspect it instead of overwriting"
                    )
                }
            }

            if Directory.Exists(root) {
                let saved = SavedRuns([]string{root})
                for row in saved.Rows {
                    if row.Matches(repo, issue) {
                        number = Math.Max(number, row.Number)
                    }
                }

                for directory in Directory.EnumerateDirectories(root, prefix + "*") {
                    if Number(directory, prefix) == 0 {
                        continue
                    }

                    if !saved.Has(directory) {
                        Reject(directory)
                    }

                    number = Math.Max(number, Number(directory, prefix))
                }
            }

            let directory = Path.Combine(root, prefix + (number + 1).ToString())

            for path in[]string{directory, Path.Combine(root, id)} {
                if Directory.Exists(path) || File.Exists(path) || FileInfo(path).LinkTarget != nil {
                    Output.Sink.RunDirectory = path
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "Saved contribution already exists; inspect it instead of overwriting"
                    )
                }
            }

            return directory
        }

        internal func Roots()[]string {
            let roots = List[string]()

            for storage in LocalPaths.StateDirectories() {
                roots.Add(Path.Combine(storage, "runs"))
            }

            return roots.ToArray()
        }

        internal func Size(path string) int64 {
            let info = FileInfo(path)

            if info.LinkTarget != nil {
                return 0
            }

            if (info.Attributes & FileAttributes.Directory) == 0 || !Directory.Exists(path) {
                return info.Length
            }

            var bytes int64

            for entry in Directory.EnumerateFileSystemEntries(path) {
                bytes += Size(entry)
            }

            return bytes
        }

        internal func Summary(directory string, run Data) Object {
            let root = LocalPaths.DirectoryPath(directory)
            let checkout = Path.Combine(root, "checkout")
            var retainedBytes int64
            var checkoutBytes int64

            for entry in Directory.EnumerateFileSystemEntries(root) {
                let bytes = Size(entry)
                retainedBytes += bytes

                if entry == checkout && Directory.Exists(entry) {
                    checkoutBytes = bytes
                }
            }

            return map[string, Object?]{
                "retained_bytes": retainedBytes,
                "checkout_bytes": checkoutBytes,
                "measurement": "Regular-file bytes; symlinks are not followed; shared/reflink blocks are not deduplicated.",
                "next_safe_cleanup": run.State == "published" || run.State == "generated" ?
                "Keep this run for amendment and recovery. Once the work is accepted and evidence is backed up, explicitly delete only this run directory; later amendment will no longer be available. Do not delete ignored or untracked files.":
                "Keep the checkout and evidence for completion or no-inference recovery. Do not delete ignored or untracked files to reclaim space."
            }
        }
    }
}
