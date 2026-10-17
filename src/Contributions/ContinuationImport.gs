package Tokate

import Microsoft.Win32.SafeHandles
import System
import System.Collections.Generic
import System.IO
import System.Runtime.InteropServices
import System.Security.Cryptography
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

@DllImport("libc", EntryPoint: "fstat")
func ContinuationStat(descriptor int32, buffer IntPtr) int32;

@DllImport("libc", EntryPoint: "syscall", SetLastError: true)
func ContinuationOpenAt(number int64, directory int32, path string, how IntPtr, size int64) int64;

@DllImport("libc", EntryPoint: "mkdirat", SetLastError: true)
func ContinuationMkdirAt(directory int32, path string, mode uint32) int32;

@DllImport("libc", EntryPoint: "unlinkat", SetLastError: true)
func ContinuationUnlinkAt(directory int32, path string, flags int32) int32;

@DllImport("libc", EntryPoint: "fchmod", SetLastError: true)
func ContinuationMode(descriptor int32, mode uint32) int32;

@DllImport("libc", EntryPoint: "renameat", SetLastError: true)
func ContinuationRenameAt(source int32, sourcePath string, target int32, targetPath string) int32;

internal class ContinuationImport {
    shared {
        private let Limit int32 = 32 * 1024 * 1024

        internal func SourceLease(directory string) FileStream {
            LocalPaths.DirectoryPath(directory)

            if !File.Exists(Path.Combine(directory, ".lock")) {
                throw CliFailure("invalid_state", "Unsupported source lease state; source is preserved")
            }

            try {
                return RunStorage.Lease(directory)
            } catch (error IOException) {
                throw CliFailure(
                    "invalid_state",
                    "Source attempt is active or leased; stop it and explicitly retry this command after its lease is released"
                )
            }
        }

        private func PathName(path string) {
            if path.Length == 0 || path.Length > 1024 || path.Contains('\\') || path.StartsWith('/') {
                throw CliFailure("invalid_state", "Unsafe continuation path")
            }

            for character in path {
                if Char.IsControl(character) {
                    throw CliFailure("invalid_state", "Unsafe continuation path")
                }
            }

            for part in path.Split('/') {
                if part == "" || part == "." || part == ".." || part.Equals(
                    ".git",
                    StringComparison.OrdinalIgnoreCase
                ) ||
                    part.Contains(':') {
                    throw CliFailure("invalid_state", "Unsafe continuation path")
                }
            }
        }

        private func Excluded(path string) bool {
            for part in path.Split('/') {
                let name = part.ToLowerInvariant()
                if name == ".env" || name.StartsWith(".env.", StringComparison.Ordinal) {
                    return true
                }

                if Array.IndexOf(
                    []string{
                        ".envrc",
                        ".npmrc",
                        ".pypirc",
                        ".gitconfig",
                        ".docker",
                        ".git",
                        ".verification-data",
                        ".agents",
                        ".aws",
                        ".azure",
                        ".kube",
                        ".gcloud",
                        ".ssh",
                        ".gnupg",
                        ".secrets",
                        ".netrc",
                        ".git-credentials",
                        "credentials.json",
                        "auth.json",
                        ".tokate",
                        ".state",
                        ".runs",
                        "tool-output",
                        ".tokate-scratch",
                        ".codex",
                        ".cache",
                        ".nuget",
                        ".npm",
                        ".local",
                        ".config",
                        "node_modules",
                        "__pycache__",
                        ".venv",
                        "venv",
                        "codex-home",
                        "gh-home",
                        "credential-home",
                        "package-cache",
                        "home",
                        "logs",
                        "artifacts",
                        "bin",
                        "obj",
                        "dist",
                        "build",
                        "target",
                        "coverage",
                        ".pytest_cache",
                        ".gradle"
                    },
                    name
                ) >= 0 {
                    return true
                }
            }

            return path.EndsWith(".log", StringComparison.OrdinalIgnoreCase) || Array.IndexOf(
                []string{
                    "events.jsonl",
                    "stderr.log",
                    "run.json",
                    "verification.json",
                    "checks.json",
                    "report.md",
                    "candidate.patch",
                    "changes.patch"
                },
                path
            ) >= 0
        }

        private func OpenAt(directory int32, path string, flags int64, mode int64 = 0, resolve int64 = 13) int32 {
            let how = Marshal.AllocHGlobal(24)

            try {
                Marshal.WriteInt64(how, 0, flags)
                Marshal.WriteInt64(how, 8, mode)
                Marshal.WriteInt64(how, 16, resolve)

                return Convert.ToInt32(ContinuationOpenAt(437, directory, path, how, 24))
            } finally {
                Marshal.FreeHGlobal(how)
            }
        }

        private func Root(directory string) SafeFileHandle {
            let descriptor = OpenAt(LocalPaths.CurrentWorkingDirectory, Path.GetFullPath(directory), 589824, resolve: 4)

            if descriptor < 0 {
                throw CliFailure(
                    "invalid_state",
                    "Continuation requires contained file access and real directories: " + directory
                )
            }

            return SafeFileHandle(IntPtr(descriptor), true)
        }

        private func Regular(handle SafeFileHandle, path string) {
            let stat = Marshal.AllocHGlobal(144)

            try {
                if ContinuationStat(handle.DangerousGetHandle().ToInt32(), stat) != 0 ||
                    (Marshal.ReadInt32(stat, 24) & LocalPaths.FileTypeMask) != LocalPaths.RegularFileType ||
                    Marshal.ReadInt64(stat, 16) != 1 {
                    throw CliFailure("invalid_state", "Continuation requires regular files without links: " + path)
                }
            } finally {
                Marshal.FreeHGlobal(stat)
            }
        }

        private func ReadFile(directory string, path string) SafeFileHandle {
            PathName(path)

            using let root = Root(directory)
            let descriptor = OpenAt(root.DangerousGetHandle().ToInt32(), path, 526336)

            if descriptor < 0 {
                throw CliFailure("invalid_state", "Cannot safely read continuation file: " + path)
            }

            let handle = SafeFileHandle(IntPtr(descriptor), true)

            var retained = false
            try {
                Regular(handle, path)
                retained = true
                return handle
            } finally {
                if !retained {
                    handle.Dispose()
                }
            }
        }

        private func Bytes(directory string, path string, limit int32 = 33554432)[]byte {
            using let handle = ReadFile(directory, path)
            using let input = FileStream(handle, FileAccess.Read)

            if !input.CanSeek || input.Length > limit {
                throw CliFailure("invalid_state", "Continuation file exceeds bounded regular-file capture: " + path)
            }

            using let output = MemoryStream()
            let buffer = [8192]byte
            var count int32

            while (
                count = input.Read(buffer, 0, Math.Min(buffer.Length, limit - Convert.ToInt32(output.Length) + 1))
            ) > 0 {
                if output.Length + count > limit {
                    throw CliFailure("invalid_state", "Continuation capture exceeds byte limit")
                }

                output.Write(buffer, 0, count)
            }

            return output.ToArray()
        }

        internal func Metadata(directory string) string {
            try {
                return UTF8Encoding(false, true).GetString(Bytes(directory, "run.json", RunStorage.RunFileByteLimit))
            } catch (error DecoderFallbackException) {
                throw CliFailure("invalid_state", error.Message, summary: CliFailure.Message("invalid_state"))
            }
        }

        private func Parent(directory string, path string) SafeFileHandle {
            var current = Root(directory)

            var retained = false
            try {
                for part in path.Split('/', StringSplitOptions.RemoveEmptyEntries) {
                    var descriptor = OpenAt(current.DangerousGetHandle().ToInt32(), part, 589824)

                    if descriptor < 0 && Marshal.GetLastWin32Error() == 2 {
                        if ContinuationMkdirAt(current.DangerousGetHandle().ToInt32(), part, 493) != 0 &&
                            Marshal.GetLastWin32Error() != 17 {
                            throw CliFailure("invalid_state", "Cannot create contained import directory: " + path)
                        }

                        descriptor = OpenAt(current.DangerousGetHandle().ToInt32(), part, 589824)
                    }

                    if descriptor < 0 {
                        throw CliFailure("invalid_state", "Unsafe import directory: " + path)
                    }

                    current.Dispose()
                    current = SafeFileHandle(IntPtr(descriptor), true)
                }

                retained = true
                return current
            } finally {
                if !retained {
                    current.Dispose()
                }
            }
        }

        private func Present(directory int32, path string) bool {
            let descriptor = OpenAt(directory, path, 526336)
            if descriptor < 0 {
                if Marshal.GetLastWin32Error() == 2 {
                    return false
                }

                throw CliFailure("invalid_state", "Unsafe continuation control or target file: " + path)
            }

            using let handle = SafeFileHandle(IntPtr(descriptor), true)
            Regular(handle, path)

            return true
        }

        private func Remove(directory int32, path string) {
            if Present(directory, path) && ContinuationUnlinkAt(directory, path, 0) != 0 {
                throw CliFailure("invalid_state", "Cannot remove contained continuation file: " + path)
            }
        }

        private func WriteFile(directory int32, path string, bytes[]byte, mode uint32) {
            let descriptor = OpenAt(directory, path, 526529, mode)

            if descriptor < 0 {
                throw CliFailure("invalid_state", "Cannot create contained continuation file: " + path)
            }

            using let handle = SafeFileHandle(IntPtr(descriptor), true)
            Regular(handle, path)

            using let output = FileStream(handle, FileAccess.Write)

            output.Write(bytes, 0, bytes.Length)

            if ContinuationMode(descriptor, mode) != 0 {
                throw CliFailure("invalid_state", "Cannot set contained continuation file mode: " + path)
            }
        }

        private func Content(value string)[]byte {
            try {
                return Convert.FromBase64String(value)
            } catch (error FormatException) {
                throw CliFailure("invalid_state", error.Message, summary: CliFailure.Message("invalid_state"))
            }
        }

        private func Apply(directory string, run Data, entry JsonElement) {
            let path = J.Text(entry, "path")
            PathName(path)

            let slash = path.LastIndexOf('/')
            let name = slash < 0 ? path: path.Substring(slash + 1)
            using let parent = Parent(Path.Combine(directory, "checkout"), slash < 0 ? "": path.Substring(0, slash))
            let target = parent.DangerousGetHandle().ToInt32()

            if J.Text(entry, "mode") == "deleted" {
                Remove(target, name)
                return
            }

            Present(target, name)
            run.ContinuationPending = path
            run.Save(directory)

            using let root = Root(directory)
            let control = root.DangerousGetHandle().ToInt32()
            let mode uint32 = J.Text(entry, "mode") == "100755" ? 493: 420

            WriteFile(control, "continuation-write.tmp", Content(J.Text(entry, "content")), mode)

            Present(target, name)

            if ContinuationRenameAt(control, "continuation-write.tmp", target, name) != 0 {
                throw CliFailure("invalid_state", "Cannot replace contained import target: " + path)
            }

            run.ClearContinuationPending()
            run.Save(directory)
        }

        private func Blob(bytes[]byte) string {
            using let hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA1)
            hash.AppendData(Encoding.UTF8.GetBytes("blob " + bytes.Length.ToString() + "\0"))
            hash.AppendData(bytes)

            return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant()
        }

        private func Files(
            root string,
            relative string,
            files HashSet[string],
            visited HashSet[string],
            exclude bool,
            depth int32 = 0
        ) {
            if depth > 64 || visited.Count > 100000 {
                throw CliFailure("invalid_state", "Continuation inventory exceeds bounded path count or depth")
            }

            for entry in Directory.EnumerateFileSystemEntries(Path.Combine(root, relative)) {
                let name = Path.GetFileName(entry)
                let path = relative == "" ? name: relative + "/" + name

                if path == ".git" || (exclude && Excluded(path)) {
                    continue
                }

                PathName(path)

                if !visited.Add(path) || visited.Count > 100000 {
                    throw CliFailure("invalid_state", "Continuation inventory exceeds bounded path count")
                }

                if FileInfo(entry).LinkTarget != nil {
                    throw CliFailure("invalid_state", "Continuation refuses symbolic links: " + path)
                }

                if Directory.Exists(entry) {
                    Files(root, path, files, visited, exclude, depth + 1)
                } else {
                    using let handle = ReadFile(root, path)
                    files.Add(path)
                }
            }
        }

        private func Paths(output string)[]string {
            if output != "" && !output.EndsWith("\0", StringComparison.Ordinal) {
                throw CliFailure("invalid_state", "Incomplete continuation Git path evidence")
            }

            return output.Split('\0', StringSplitOptions.RemoveEmptyEntries)
        }

        private func Scan(checkout string, run Data, record JsonElement, exclude bool) JsonElement {
            Verification.Candidate(checkout)

            let baseline = ProtectedPaths.LocalTree(checkout, run.Base)

            for entry in baseline {
                PathName(entry.Key)
                if Excluded(entry.Key) ||
                    (
                    !entry.Value.StartsWith("040000 tree ") && !entry.Value.StartsWith("100644 blob ") &&
                        !entry
                        .Value
                        .StartsWith("100755 blob ")
                ) {
                    throw CliFailure(
                        "invalid_state",
                        "Unsupported generated, linked or submodule path in approved base: " + entry.Key
                    )
                }
            }

            let index = Dictionary[string, string](StringComparer.Ordinal)

            for entry in Paths(Commands.GitRaw(checkout, []string{"ls-files", "--stage", "-z"})) {
                let tab = entry.IndexOf('\t')
                let fields = (tab < 0 ? "": entry.Substring(0, tab)).Split(' ')
                let path = tab < 0 ? "": entry.Substring(tab + 1)

                PathName(path)

                if fields.Length != 3 || fields[2] != "0" || !index.TryAdd(
                    path,
                    fields[0] + " blob " + RepositoryIdentity.CommitSha(fields[1])
                ) ||
                    Excluded(path) {
                    throw CliFailure("invalid_state", "Ambiguous or unsupported continuation index")
                }
            }

            let files = HashSet[string](StringComparer.Ordinal)
            let visited = HashSet[string](StringComparer.Ordinal)

            Files(checkout, "", files, visited, exclude)

            for entry in baseline {
                let wasDirectory = entry.Value.StartsWith("040000 tree ")
                let isDirectory = visited.Contains(entry.Key) && !files.Contains(entry.Key)
                if visited.Contains(entry.Key) && wasDirectory != isDirectory {
                    throw CliFailure(
                        "invalid_state",
                        "Continuation does not support file/directory replacement: " + entry.Key
                    )
                }
            }

            let changed = HashSet[string](StringComparer.Ordinal)

            for entry in index {
                var original string
                if !baseline.TryGetValue(entry.Key, out original) || original != entry.Value {
                    changed.Add(entry.Key)
                }
            }

            for path in Paths(
                Commands.GitRaw(
                    checkout,
                    []string{
                        "-c",
                        "diff.autoRefreshIndex=false",
                        "diff",
                        "--no-ext-diff",
                        "--no-textconv",
                        "--no-renames",
                        "--name-only",
                        "-z",
                        run.Base,
                        "--"
                    }
                )
            ) {
                PathName(path)
                changed.Add(path)
            }

            for path in files {
                if !baseline.ContainsKey(path) {
                    changed.Add(path)
                }
            }

            if changed.Count > 1000 {
                throw CliFailure("invalid_state", "Continuation exceeds 1000 changed paths")
            }

            return ScanEntries(checkout, record, baseline, index, files, changed)
        }

        private func ScanEntries(
            checkout string,
            record JsonElement,
            baseline Dictionary[string, string],
            index Dictionary[string, string],
            files HashSet[string],
            changed HashSet[string]
        ) JsonElement {
            let entries = List[Object]()
            let ordered = List[string](changed)
            ordered.Sort(StringComparer.Ordinal)

            var total int32

            for path in ordered {
                PathName(path)

                if Excluded(path) {
                    throw CliFailure(
                        "invalid_state",
                        "Tracked generated or credential path changes cannot be imported: " + path
                    )
                }

                var mode = "deleted"
                var content = ""
                var blob = ""

                if files.Contains(path) {
                    let bytes = Bytes(checkout, path, Limit - total)
                    total += bytes.Length
                    mode = (
                        File.GetUnixFileMode(Path.Combine(checkout, path)) & (
                            UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute
                        )
                    ) != 0 ? "100755": "100644"
                    content = Convert.ToBase64String(bytes)
                    blob = Blob(bytes)
                }

                var staged string
                var original string
                let hasStaged = index.TryGetValue(path, out staged)
                let hasOriginal = baseline.TryGetValue(path, out original)

                if hasOriginal && original.StartsWith("040000 tree ") {
                    throw CliFailure(
                        "invalid_state",
                        "Continuation does not support file/directory replacement: " + path
                    )
                }

                let current = mode == "deleted" ? "": mode + " blob " + blob

                if (hasStaged ? staged: "") != (hasOriginal ? original: "") && (hasStaged ? staged: "") != current {
                    throw CliFailure("invalid_state", "Staged and available file evidence disagree: " + path)
                }

                if hasOriginal && original == current {
                    continue
                }

                ProtectedPaths.Check(J.Get(record, "policy"), J.Get(record, "approval"), path)
                entries.Add(map[string, Object?]{"path": path, "mode": mode, "blob": blob, "content": content})
            }

            return J.Parse(J.Write(entries))
        }

        private func Evidence(directory string) JsonElement {
            let result = map[string, Object?]{}

            for name in[]string{
                "run.json",
                "events.jsonl",
                "stderr.log",
                "report.md",
                "verification.json",
                "candidate.patch",
                "changes.patch"
            } {
                let path = Path.Combine(directory, name)

                if FileInfo(path).LinkTarget != nil {
                    throw CliFailure("invalid_state", "Source evidence must not be linked")
                }

                result[name] = File.Exists(path) ? Convert.ToHexString(SHA256.HashData(Bytes(directory, name)))
                    .ToLowerInvariant(): nil
            }

            return J.Parse(J.Write(result))
        }

        internal func Capture(directory string, run Data, record JsonElement) {
            let sourceDirectory = run.ContinuationSource
            using let sourceLease = SourceLease(sourceDirectory)
            let source = AttemptContinuation.Source(sourceDirectory, run, record)

            let sourceText = Metadata(sourceDirectory)

            if J.Hash(sourceText) != run.ContinuationSourceMetadataSha256 || !RequestData.Same(
                AttemptContinuation.Provenance(source),
                run.Continuation
            ) {
                throw CliFailure(
                    "invalid_state",
                    "Source metadata or attribution changed since explicit preparation; source is preserved"
                )
            }

            let evidence = Evidence(sourceDirectory)
            let entries = Scan(Path.Combine(sourceDirectory, "checkout"), source, record, true)

            if !RequestData.Same(evidence, Evidence(sourceDirectory)) || !RequestData.Same(
                entries,
                Scan(Path.Combine(sourceDirectory, "checkout"), source, record, true)
            ) {
                throw CliFailure("invalid_state", "Source changed during capture; source is preserved")
            }

            let path = Path.Combine(directory, "continuation.json")
            let manifest = J.Write(
                map[string, Object?]{
                    "version": 1,
                    "source_metadata": sourceText,
                    "evidence": evidence,
                    "predecessor": AttemptContinuation.Provenance(source),
                    "entries": entries
                }
            )

            if File.Exists(path) {
                if Encoding.UTF8.GetString(Bytes(directory, "continuation.json", 48 * 1024 * 1024)) != manifest {
                    throw CliFailure(
                        "invalid_state",
                        "Interrupted capture differs from source; inspect this saved preparation, no new reservation is created"
                    )
                }
            } else {
                using let root = Root(directory)
                let control = root.DangerousGetHandle().ToInt32()

                Remove(control, "continuation.json.tmp")
                WriteFile(control, "continuation.json.tmp", Encoding.UTF8.GetBytes(manifest), 420)

                if Present(control, "continuation.json") ||
                    ContinuationRenameAt(control, "continuation.json.tmp", control, "continuation.json") != 0 {
                    throw CliFailure(
                        "invalid_state",
                        "Capture manifest changed during preparation; inspect this saved run"
                    )
                }
            }

            run.Continuation = AttemptContinuation.Provenance(source)
            run.ContinuationManifestSha256 = J.Hash(manifest)
            run.ContinuationPhase = "captured"

            run.Save(directory)
        }

        private func Manifest(directory string, run Data) JsonElement {
            let text = Encoding.UTF8.GetString(Bytes(directory, "continuation.json", 48 * 1024 * 1024))

            if J.Hash(text) != run.ContinuationManifestSha256 {
                throw CliFailure(
                    "invalid_state",
                    "Captured continuation manifest changed; inspect the original preparation"
                )
            }

            var manifest JsonElement
            try {
                manifest = J.Parse(text)
            } catch (error JsonException) {
                throw CliFailure("invalid_state", error.Message, summary: CliFailure.Message("invalid_state"))
            }

            if J.Number(manifest, "version") != 1 || !RequestData.Same(
                J.Get(manifest, "predecessor"),
                run.Continuation
            ) {
                throw CliFailure("invalid_state", "Continuation predecessor evidence changed")
            }

            let paths = HashSet[string](StringComparer.Ordinal)
            var total int32

            for entry in J.Items(J.Get(manifest, "entries")) {
                let path = J.Text(entry, "path")
                PathName(path)

                if !paths.Add(path) || paths.Count > 1000 || Excluded(path) {
                    throw CliFailure("invalid_state", "Unsafe or ambiguous captured continuation paths")
                }

                let mode = J.Text(entry, "mode")
                let bytes = Content(J.Text(entry, "content"))
                total += bytes.Length

                if total > Limit ||
                    (mode != "deleted" && mode != "100644" && mode != "100755") ||
                    (
                    mode == "deleted" ? bytes.Length != 0 || J.Text(entry, "blob") != "": Blob(bytes) != J.Text(
                        entry,
                        "blob"
                    )
                ) {
                    throw CliFailure("invalid_state", "Inconsistent captured continuation content")
                }
            }

            return manifest
        }

        internal func Check(directory string, run Data, record JsonElement, allowPartial bool = false) {
            let manifest = Manifest(directory, run)
            CheckSource(run, record, manifest)

            let checkout = Path.Combine(directory, "checkout")
            let staged = Commands.GitResult(checkout, []string{"diff", "--cached", "--quiet", run.Base, "--"})

            if staged.Code != 0 || staged.Truncated || staged.ReadFailed {
                throw CliFailure("invalid_state", "Import target index differs from the approved base")
            }

            let actual = Scan(checkout, run, record, false)
            let expected = J.Get(manifest, "entries")

            if !allowPartial {
                if !RequestData.Same(actual, expected) {
                    throw CliFailure(
                        "invalid_state",
                        "Imported edits differ from their captured manifest; inspect this preparation before inference"
                    )
                }
            } else {
                let allowed = Dictionary[string, string](StringComparer.Ordinal)

                for entry in J.Items(expected) {
                    allowed.Add(J.Text(entry, "path"), RequestData.Canonical(entry))
                }

                for entry in J.Items(actual) {
                    var value string
                    if !allowed.TryGetValue(J.Text(entry, "path"), out value) || value != RequestData.Canonical(entry) {
                        throw CliFailure(
                            "invalid_state",
                            "Interrupted import has dirty or unrelated edits; inspect this saved preparation"
                        )
                    }
                }
            }
        }

        internal func Import(directory string, run Data, record JsonElement) {
            if run.ContinuationPhase == "" {
                Capture(directory, run, record)
            }

            let manifest = Manifest(directory, run)

            Check(directory, run, record, run.ContinuationPhase != "imported")

            if run.ContinuationPhase == "imported" {
                return
            }

            using let root = Root(directory)
            let control = root.DangerousGetHandle().ToInt32()
            let pending = run.ContinuationPending

            if pending != "" {
                var known bool
                for entry in J.Items(J.Get(manifest, "entries")) {
                    known = known || J.Text(entry, "path") == pending
                }

                if !known {
                    throw CliFailure(
                        "invalid_state",
                        "Interrupted import has unidentified pending content; inspect this saved preparation"
                    )
                }

                Remove(control, "continuation-write.tmp")
                run.ClearContinuationPending()
            } else if Present(control, "continuation-write.tmp") {
                throw CliFailure("invalid_state", "Unidentified import temporary file; inspect this saved preparation")
            }

            run.ContinuationPhase = "importing"
            run.Save(directory)

            for entry in J.Items(J.Get(manifest, "entries")) {
                Apply(directory, run, entry)
            }

            Check(directory, run, record)

            run.ContinuationPhase = "imported"
            run.Save(directory)
        }

        private func CheckSource(run Data, record JsonElement, manifest JsonElement) {
            let directory = run.ContinuationSource
            using let lease = SourceLease(directory)
            let source = AttemptContinuation.Source(directory, run, record)

            if Metadata(directory) != J.Text(manifest, "source_metadata") || J.Hash(
                Metadata(directory)
            ) != run.ContinuationSourceMetadataSha256 ||
                !RequestData.Same(AttemptContinuation.Provenance(source), J.Get(manifest, "predecessor")) ||
                !RequestData.Same(Evidence(directory), J.Get(manifest, "evidence")) || !RequestData.Same(
                Scan(Path.Combine(directory, "checkout"), source, record, true),
                J.Get(manifest, "entries")
            ) ||
                !RequestData.Same(
                Scan(Path.Combine(directory, "checkout"), source, record, true),
                J.Get(manifest, "entries")
            ) ||
                !RequestData
                .Same(Evidence(directory), J.Get(manifest, "evidence")) {
                throw CliFailure(
                    "invalid_state",
                    "Source evidence changed since continuation capture; preserved import cannot resume"
                )
            }
        }
    }
}
