package Tokate

import System
import System.Collections.Generic
import System.Text
import System.Text.Json

internal class ProtectedPaths {
    shared {
        private const PathCountLimit int32 = 64

        private const PathCharacterLimit int32 = 512

        internal const InventoryPathCountLimit int32 = 100000

        private const DiffPathEntryLimit int32 = InventoryPathCountLimit + 1

        private const ProtectedRelation int32 = 2

        private let Utf8 UTF8Encoding = UTF8Encoding(false, true)

        internal func Validate(paths JsonElement) {
            if paths.ValueKind == JsonValueKind.Undefined {
                return
            }

            if paths.ValueKind != JsonValueKind.Array || paths.GetArrayLength() > PathCountLimit {
                throw Exception("protected_paths must be an array of at most 64 literal repository paths")
            }

            for entry in paths.EnumerateArray() {
                if entry.ValueKind != JsonValueKind.String {
                    throw Exception("protected_paths entries must be nonempty strings of at most 512 characters")
                }

                let path = entry.GetString() ?? ""
                if path.Length == 0 || path.Length > PathCharacterLimit || path.Contains('\\') ||
                    (path.Length >= 3 && Char.IsAsciiLetter(path[0]) && path[1] == ':' && path[2] == '/') {
                    throw Exception("Invalid protected_paths entry")
                }

                for character in path {
                    if Char.IsControl(character) {
                        throw Exception("Invalid protected_paths control character")
                    }
                }

                Relative(path.EndsWith("/", StringComparison.Ordinal) ? path.Substring(0, path.Length - 1): path)
                Utf8.GetBytes(path)
            }
        }

        internal func Relative(path string) {
            for segment in path.Split('/') {
                if segment == "" || segment == "." || segment == ".." || segment.Contains('\0') {
                    throw Exception("Expected a literal repository-relative slash path")
                }
            }
        }

        private func Matches(entry string, path string) bool {
            if entry.EndsWith("/", StringComparison.Ordinal) {
                return (entry.Length == path.Length + 1 && entry.StartsWith(path, StringComparison.Ordinal)) ||
                    path.StartsWith(entry, StringComparison.Ordinal)
            }

            return path == entry
        }

        internal func Check(policy JsonElement, approval JsonElement, path string) -> Check(
            J.Items(Policy.Parse(policy).ProtectedPaths),
            Decree.HasSnapshot(approval),
            path
        )

        private func Check(configured List[JsonElement], decree bool, path string) {
            if decree && (path == "DECREE.md" || path.StartsWith("DECREE.md/")) {
                throw CliFailure("protected_path", "Contribution changes approved root DECREE.md: " + J.Write(path))
            }

            if Matches(".github/workflows/", path) || path.StartsWith(".github/tokate", StringComparison.Ordinal) {
                throw CliFailure(
                    "protected_path",
                    "Contribution changes protected owner configuration: " + J.Write(path)
                )
            }

            for entry in configured {
                if Matches(entry.GetString() ?? "", path) {
                    throw CliFailure("protected_path", "Contribution changes protected owner path: " + J.Write(path))
                }
            }
        }

        private func Relation(configured List[string], approval JsonElement, path string) int32 {
            if Decree.Protected(path, approval) || Matches(".github/workflows/", path) || path.StartsWith(
                ".github/tokate",
                StringComparison.Ordinal
            ) {
                return ProtectedRelation
            }

            var ancestor = path == ".github"
            let prefix = configured.Count == 0 ? "": path + "/"

            for name in configured {
                if Matches(name, path) {
                    return ProtectedRelation
                }

                if name.StartsWith(prefix, StringComparison.Ordinal) {
                    ancestor = true
                }
            }

            return ancestor ? 1: 0
        }

        internal func AddTree(entries Dictionary[string, string], path string, mode string, type string, sha string) {
            Relative(path)
            RepositoryIdentity.CommitSha(sha)

            if !(
                (mode == GitHub.TreeMode && type == GitHub.TreeType) ||
                    (
                    (
                        mode == GitHub.RegularFileMode ||
                            mode == GitHub.ExecutableFileMode ||
                            mode == GitHub.SymbolicLinkMode
                    ) &&
                        type == GitHub.BlobType
                ) ||
                    (mode == GitHub.SubmoduleMode && type == GitHub.CommitType)
            ) ||
                !entries.TryAdd(path, mode + " " + type + " " + sha) {
                throw Exception("Incomplete, duplicate or invalid protected tree evidence")
            }
        }

        internal func CompleteTree(entries Dictionary[string, string]) {
            if entries.Count > InventoryPathCountLimit {
                throw Exception("Protected tree exceeds bounded evidence")
            }

            for entry in entries {
                var path = entry.Key
                var slash = path.LastIndexOf('/')

                while slash >= 0 {
                    path = path.Substring(0, slash)
                    var value string

                    if !entries.TryGetValue(path, out value) || !value.StartsWith(
                        GitHub.TreeMode + " " + GitHub.TreeType + " ",
                        StringComparison.Ordinal
                    ) {
                        throw Exception("Missing protected tree ancestor evidence")
                    }

                    slash = path.LastIndexOf('/')
                }
            }
        }

        internal func LocalTree(checkout string, head string) Dictionary[string, string] {
            let output = Commands.GitRaw(
                checkout,
                []string{"ls-tree", "-r", "-t", "-z", "--full-tree", RepositoryIdentity.CommitSha(head)}
            )
            let entries = Dictionary[string, string](StringComparer.Ordinal)

            if output != "" && !output.EndsWith("\0", StringComparison.Ordinal) {
                throw Exception("Truncated protected tree evidence")
            }

            for line in output.Split('\0') {
                if line == "" {
                    continue
                }

                let tab = line.IndexOf('\t')
                let fields = (tab < 0 ? "": line.Substring(0, tab)).Split(' ')
                if fields.Length != 3 {
                    throw Exception("Invalid protected tree evidence")
                }

                AddTree(entries, line.Substring(tab + 1), fields[0], fields[1], fields[2])
            }

            CompleteTree(entries)

            return entries
        }

        internal func Local(
            checkout string,
            policy JsonElement,
            approval JsonElement,
            base string,
            head string = "",
            budget RuntimeBudget? = nil
        ) {
            let args = List[string]{
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--ignore-submodules=none",
                "--no-renames",
                "--name-only",
                "-z"
            }

            if head == "" {
                args.Add("--cached")
            }

            args.Add(RepositoryIdentity.CommitSha(base))
            if head != "" {
                args.Add(RepositoryIdentity.CommitSha(head))
            }

            args.Add("--")
            let output = Commands.GitRaw(checkout, args.ToArray(), budget)

            if output == "" || !output.EndsWith("\0", StringComparison.Ordinal) {
                throw Exception("Contribution needs complete nonempty Git path evidence")
            }

            let paths = output.Split('\0')
            if paths.Length > DiffPathEntryLimit {
                throw Exception("Contribution exceeds the bounded Git path diff")
            }

            let configured = J.Items(Policy.Parse(policy).ProtectedPaths)
            let decree = Decree.HasSnapshot(approval)

            for i in 0 ... paths.Length - 1 {
                Relative(paths[i])
                Check(configured, decree, paths[i])
            }
        }
    }
}
