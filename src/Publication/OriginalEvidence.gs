package Tokate

import Microsoft.Win32.SafeHandles
import System
import System.Collections.Generic
import System.IO
import System.Runtime.InteropServices
import System.Security.Cryptography
import System.Text.Json

@DllImport("libc", EntryPoint: "open", SetLastError: true)
func EvidenceOpen(path string, flags int32) int32;

internal class OriginalEvidence {
    shared {
        private func FileHash(path string) string {
            using let stream = File.OpenRead(path)
            return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant()
        }

        internal func CopyFile(source string, target string) {
            try {
                let descriptor = EvidenceOpen(source, 131072 | 2048)

                if descriptor < 0 {
                    throw CliFailure("command_failed", "Cannot safely capture original evidence: " + source)
                }

                using let handle = SafeFileHandle(IntPtr(descriptor), true)
                using let input = FileStream(handle, FileAccess.Read)

                if !input.CanSeek {
                    throw CliFailure("invalid_state", "Original evidence must be a regular file: " + source)
                }

                using let output = FileStream(
                    target,
                    FileStreamOptions{
                        Mode: FileMode.CreateNew,
                        Access: FileAccess.Write,
                        Share: FileShare.None,
                        UnixCreateMode: UnixFileMode.UserRead | UnixFileMode.UserWrite
                    }
                )

                input.CopyTo(output)
            } catch (error Exception) when error is IOException || error is UnauthorizedAccessException {
                throw CliFailure("command_failed", error.Message, summary: CliFailure.Message("command_failed"))
            }
        }

        private func Inventory(directory string) Dictionary[string, Object?] {
            let files = Dictionary[string, Object?]()

            for path in Directory.EnumerateFileSystemEntries(directory) {
                if FileInfo(path).LinkTarget != nil {
                    throw CliFailure("invalid_state", "Original archive contains a link")
                }

                if Directory.Exists(path) {
                    for entry in Inventory(path) {
                        files[Path.GetFileName(path) + "/" + entry.Key] = entry.Value
                    }
                } else {
                    files[Path.GetFileName(path)] = FileHash(path)
                }
            }

            return files
        }

        internal func VerificationArtifacts(directory string, target string) {
            try {
                LocalPaths.DirectoryPath(directory)

                for evidence in Directory.EnumerateFileSystemEntries(directory, "verification-*") {
                    if FileInfo(evidence).LinkTarget != nil || !Directory.Exists(evidence) {
                        throw CliFailure(
                            "invalid_state",
                            "Original verification evidence must be real directories without links"
                        )
                    }

                    let destination = Path.Combine(target, Path.GetFileName(evidence))

                    Directory.CreateDirectory(destination)

                    for file in Directory.EnumerateFileSystemEntries(evidence) {
                        CopyFile(file, Path.Combine(destination, Path.GetFileName(file)))
                    }
                }
            } catch (error Exception) when error is IOException || error is UnauthorizedAccessException {
                throw CliFailure("command_failed", error.Message, summary: CliFailure.Message("command_failed"))
            }
        }

        private func VerificationReferences(directory string, checks JsonElement) {
            let root = LocalPaths.DirectoryPath(directory)

            for check in J.Items(checks) {
                for field in[]string{"output_file", "error_file"} {
                    let value = J.Get(check, field)

                    if value.ValueKind == JsonValueKind.Undefined {
                        continue
                    }

                    let relative = J.Text(check, field)
                    let path = Path.GetFullPath(Path.Combine(root, relative))
                    let failure = "Original recorded verification artifact is missing or outside its archive"

                    if relative == "" || Path.IsPathRooted(relative) || !path.StartsWith(
                        root + "/",
                        StringComparison.Ordinal
                    ) {
                        throw CliFailure("invalid_state", failure)
                    }

                    LocalPaths.DirectoryPath(Path.GetDirectoryName(path) ?? root)

                    if FileInfo(path).LinkTarget != nil || !File.Exists(path) {
                        throw CliFailure("invalid_state", failure)
                    }
                }
            }
        }

        internal func Seal(directory string) {
            try {
                VerificationReferences(directory, J.Get(Data.Load(directory).Element(), "verification"))

                let checks = Path.Combine(directory, "verification.json")

                if File.Exists(checks) {
                    VerificationReferences(directory, J.Parse(File.ReadAllText(checks)))
                }

                let inventory = Inventory(directory)
                let manifest = RequestData.Canonical(J.Parse(J.Write(inventory)))

                File.WriteAllText(Path.Combine(directory, "manifest.json"), manifest + "\n")

                let seal = Data()
                seal.Fields["manifest_sha256"] = J.Hash(manifest)

                seal.Write(Path.Combine(directory, "seal.json"))
            } catch (error Exception) when error is IOException ||
                error is UnauthorizedAccessException ||
                error is JsonException {
                throw CliFailure("command_failed", error.Message, summary: CliFailure.Message("command_failed"))
            }
        }

        internal func Load(directory string, run Data? = nil) Data {
            try {
                let archive = LocalPaths.DirectoryPath(Path.Combine(directory, "original-evidence"))
                let inventory = Inventory(archive)
                let manifest = File.ReadAllText(Path.Combine(archive, "manifest.json")).TrimEnd('\n')
                let seal = Data.Read(Path.Combine(archive, "seal.json"))

                inventory.Remove("manifest.json")
                inventory.Remove("seal.json")

                if J.Hash(manifest) != seal.Text("manifest_sha256") || RequestData.Canonical(
                    J.Parse(J.Write(inventory))
                ) != manifest {
                    throw CliFailure(
                        "invalid_state",
                        "Original evidence archive changed or is incomplete; no silent reconstruction is allowed"
                    )
                }

                let original = Data.Load(archive)

                if run != nil {
                    Authority(original, run)
                }

                return original
            } catch (error Exception) when error is IOException ||
                error is UnauthorizedAccessException ||
                error is JsonException {
                throw CliFailure("invalid_state", error.Message, summary: CliFailure.Message("invalid_state"))
            }
        }

        private func Authority(original Data, run Data) {
            for key in[]string{
                "version",
                "id",
                "repo",
                "issue",
                "donor",
                "donor_id",
                "head_repo",
                "approval",
                "state_sha",
                "attempt",
                "base",
                "base_branch",
                "policy_hash",
                "branch",
                "model",
                "requested_model",
                "reported_model",
                "effort",
                "seconds",
                "source",
                "tools",
                "usage",
                "execution_seconds",
                "elapsed_seconds",
                "codex_version",
                "pi_version",
                "claude_version",
                "omp_version",
                "inference_exit_code",
                "turn_completed"
            } {
                if key == "repo" || key == "head_repo" {
                    if !RepositoryIdentity.SameRepo(original.Text(key), run.Text(key)) {
                        throw CliFailure("stale_approval", "Saved original authority changed: " + key)
                    }
                } else if !RequestData.Same(J.Get(original.Element(), key), J.Get(run.Element(), key)) {
                    throw CliFailure(
                        "stale_approval",
                        "Saved original authority or execution attribution changed: " + key
                    )
                }
            }
        }

        private func CopyTree(source string, target string, links List[Object], relative string = "") {
            Directory.CreateDirectory(target)

            for entry in Directory.EnumerateFileSystemEntries(source) {
                let name = Path.GetFileName(entry)

                if relative == "" && name == ".git" {
                    continue
                }

                let path = relative == "" ? name: relative + "/" + name
                let info = FileInfo(entry)

                if info.LinkTarget != nil {
                    links.Add(map[string, Object?]{"path": path, "target": info.LinkTarget})
                } else if Directory.Exists(entry) {
                    CopyTree(entry, Path.Combine(target, name), links, path)
                } else {
                    OriginalEvidence.CopyFile(entry, Path.Combine(target, name))
                }
            }
        }

        internal func Capture(directory string, run Data, record JsonElement = default(JsonElement)) string {
            LocalPaths.DirectoryPath(directory)

            let final = Path.Combine(directory, "original-evidence")

            if FileInfo(final).LinkTarget != nil {
                throw CliFailure("invalid_state", "Original evidence archive must not be a link")
            }

            if Directory.Exists(final) {
                Amended(directory, run)
                return Data.Read(Path.Combine(final, "seal.json")).Text("manifest_sha256")
            }

            let checkout = Verification.Validate(Path.Combine(directory, "checkout"))
            let temporary = Path.Combine(directory, "original-evidence-" + Guid.NewGuid().ToString("N") + ".tmp")

            Directory.CreateDirectory(
                temporary,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
            )

            try {
                let missing = List[string]()
                let links = List[Object]()
                for file in Directory.EnumerateFiles(directory) {
                    if Path.GetFileName(file) != ".lock" {
                        CopyFile(file, Path.Combine(temporary, Path.GetFileName(file)))
                    }
                }

                OriginalEvidence.VerificationArtifacts(directory, temporary)

                if record.ValueKind != JsonValueKind.Undefined {
                    for file in[]string{
                        "run.json",
                        "events.jsonl",
                        "report.md",
                        "stderr.log",
                        "candidate.patch",
                        "changes.patch",
                        "verification.json",
                        "checks.json",
                        "publication.json",
                        "request.json",
                        "pr-body.md"
                    } {
                        if !File.Exists(Path.Combine(directory, file)) {
                            missing.Add(file)
                        }
                    }
                    File.WriteAllText(Path.Combine(temporary, "approval.json"), J.Write(record) + "\n")
                    for kind in[]string{"staged", "unstaged"} {
                        let args = List[string]{
                            "diff",
                            "--no-ext-diff",
                            "--no-textconv",
                            "--binary",
                            "--full-index",
                            "--find-renames=100%"
                        }
                        if kind == "staged" {
                            args.AddRange([]string{"--cached", run.Text("base")})
                        }
                        args.Add("--")
                        File.WriteAllText(
                            Path.Combine(temporary, kind + ".patch"),
                            Commands.GitRaw(checkout, args.ToArray())
                        )
                    }
                    File.WriteAllText(
                        Path.Combine(temporary, "status.txt"),
                        Commands.GitRaw(checkout, []string{"status", "--porcelain=v1", "--untracked-files=all"})
                    )
                    CopyTree(checkout, Path.Combine(temporary, "checkout"), links)
                    let capture = Data(
                        map[string, Object?]{
                            "captured_at": DateTimeOffset.UtcNow.ToString("O"),
                            "head": Commands.Git(checkout, "rev-parse", "HEAD"),
                            "missing": missing,
                            "links": links,
                            "failure": run.Text("error"),
                            "candidate_provenance": "Available staged/unstaged/untracked evidence captured at preparation; original model provenance is unproven. Missing original artifacts are not reconstructed."
                        }
                    )
                    capture.Write(Path.Combine(temporary, "capture.json"))
                }

                OriginalEvidence.Seal(temporary)

                Directory.Move(temporary, final)
            } finally {
                if Directory.Exists(temporary) {
                    Directory.Delete(temporary, true)
                }
            }
            return Data.Read(Path.Combine(final, "seal.json")).Text("manifest_sha256")
        }

        internal func Pinned(directory string, run Data, record JsonElement) {
            if !Directory.Exists(Path.Combine(directory, "original-evidence")) {
                return
            }
            Load(directory, run)
            let pinned = J.Parse(File.ReadAllText(Path.Combine(directory, "original-evidence", "approval.json")))
            for key in[]string{"approval", "policy", "template"} {
                let previous = J.Get(pinned, key)
                let current = J.Get(record, key)
                let same = key == "policy" ? Policy(J.Write(previous)).Digest == Policy(
                    J.Write(current)
                ).Digest: RequestData.Same(previous, current)
                if !same {
                    throw CliFailure("stale_approval", "Original approval, policy or template changed")
                }
            }
        }

        internal func Amended(directory string, run Data, amendment Data? = nil) Data {
            try {
                let archive = LocalPaths.DirectoryPath(Path.Combine(directory, "original-evidence"))
                let history = J.Items(J.Get(run.Element(), "amendments"))
                var first = amendment

                if history.Count > 0 {
                    let location = LocalPaths.DirectoryPath(
                        Path.Combine(directory, "amendments", RepositoryIdentity.CommitSha(J.Text(history[0], "head")))
                    )

                    if FileInfo(Path.Combine(location, "run.json")).LinkTarget != nil {
                        throw CliFailure("invalid_state", "Saved original amendment must not be a link")
                    }

                    first = Data.Load(location, amendment: true)

                    if first.Text("id") != J.Text(history[0], "id") {
                        throw CliFailure("invalid_state", "Saved first amendment differs from contribution history")
                    }
                }

                let original = Load(directory, run)
                let digest = Data.Read(Path.Combine(archive, "seal.json")).Text("manifest_sha256")

                for saved in[]Data? {first, amendment} {
                    if saved != nil && saved.Text("original_evidence_sha256") != digest {
                        throw CliFailure("invalid_state", "Saved original evidence seal changed")
                    }
                }

                return original
            } catch (error Exception) when error is IOException || error is UnauthorizedAccessException {
                throw CliFailure("invalid_state", error.Message, summary: CliFailure.Message("invalid_state"))
            }
        }
    }
}
