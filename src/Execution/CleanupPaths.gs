package Tokate

import System
import System.Collections.Generic
import System.IO

internal class CleanupTarget(run SavedRun, path string, ignored bool) {
    internal let Run SavedRun = run
    internal let Path string = path
    internal let Ignored bool = ignored
    internal let Bytes int64 = RunStorage.Size(path)

    internal func Summary() Object -> map[string, Object?]{
        "run": Run.Location,
        "path": Path,
        "bytes": Bytes,
        "ignored": Ignored
    }
}

internal class CleanupPaths {
    shared {
        internal func Ignored(row SavedRun, selected string = "") List[CleanupTarget] {
            let result = List[CleanupTarget]()
            let checkout = Path.Combine(LocalPaths.DirectoryPath(row.Location), "checkout")

            if !Directory.Exists(checkout) {
                if selected != "" {
                    throw CliFailure("invalid_state", "No checkout in " + row.Location)
                }

                return result
            }

            Verification.Validate(checkout)
            let paths = selected != "" ? []string{selected}: Commands.GitRaw(
                checkout,
                []string{"ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"}
            )
                .Split('\0', StringSplitOptions.RemoveEmptyEntries)

            for name in paths {
                let path = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.Combine(checkout, name)))

                if selected == "" && (!Directory.Exists(path) || FileInfo(path).LinkTarget != nil) {
                    continue
                }

                ValidateIgnored(checkout, path)
                result.Add(CleanupTarget(row, path, true))
            }

            result.Sort((a, b) -> b.Bytes.CompareTo(a.Bytes))

            if selected == "" && result.Count > 5 {
                result.RemoveRange(5, result.Count - 5)
            }

            return result
        }

        internal func ValidateIgnored(checkout string, path string) {
            let relative = Path.GetRelativePath(checkout, path)

            if path == checkout || !LocalPaths.Within(path, checkout) || Array.IndexOf(
                relative.Split('/'),
                ".git"
            ) >= 0 {
                throw CliFailure("invalid_arguments", "Select one ignored directory inside " + checkout + ": " + path)
            }

            LocalPaths.DirectoryPath(path)
            let ignored = Commands.GitResult(checkout, []string{"check-ignore", "-q", "--", relative})
            let tracked = Commands.GitRaw(
                checkout,
                []string{"ls-files", "--cached", "-z", "--", ":(literal)" + relative}
            )

            if ignored.Code != 0 || tracked != "" {
                throw CliFailure("invalid_state", "Directory is not wholly ignored and untracked: " + path)
            }
        }

        internal func Delete(path string) {
            try {
                let info = FileInfo(path)

                if info.LinkTarget != nil {
                    File.Delete(path)
                    return
                }

                if (info.Attributes & FileAttributes.Directory) == 0 {
                    File.Delete(path)
                    return
                }

                LocalPaths.DirectoryPath(path)
                File.SetUnixFileMode(
                    path,
                    File.GetUnixFileMode(path) | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                )

                for entry in Directory.EnumerateFileSystemEntries(path) {
                    Delete(entry)
                }

                Directory.Delete(path)
            } catch (error Exception) when error is IOException || error is UnauthorizedAccessException {
                throw CliFailure("command_failed", "Cleanup failed at " + path + ": " + error.Message)
            }
        }
    }
}
