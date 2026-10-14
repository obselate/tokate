package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Linq
import System.Net.Http
import System.Text
import System.Text.Json

internal class GratisGuidance {
    shared {
        internal func Prompt(source string) string {
            if source == "" {
                return "Choose one useful task permitted by the repository guidance, or complete the selected issue."
            }
            var text string
            var uri Uri
            if !Path.IsPathFullyQualified(source) && Uri.TryCreate(source, UriKind.Absolute, out uri) {
                if uri.Scheme != "https" {
                    throw CliFailure("invalid_arguments", "Prompt URLs must use HTTPS")
                }
                using let handler = HttpClientHandler{AllowAutoRedirect: false}
                using let client = HttpClient(handler)
                client.Timeout = TimeSpan.FromSeconds(30)
                using let response = client
                    .GetAsync(uri, HttpCompletionOption.ResponseHeadersRead)
                    .GetAwaiter()
                    .GetResult()
                response.EnsureSuccessStatusCode()
                using let stream = response.Content.ReadAsStream()
                text = Read(stream)
            } else {
                using let stream = File.OpenRead(source)
                text = Read(stream)
            }
            if String.IsNullOrWhiteSpace(text) {
                throw CliFailure("invalid_arguments", "Prompt text is empty")
            }
            return text
        }

        private func Read(stream Stream) string {
            let bytes = [32769]byte
            let count = stream.ReadAtLeast(bytes, bytes.Length, false)
            if count > 32768 {
                throw CliFailure("invalid_arguments", "Prompt text exceeds 32 KiB")
            }
            return UTF8Encoding(false, true).GetString(bytes, 0, count)
        }

        private func Relative(path string, target string) string {
            let full = Path.GetFullPath(Path.Combine("/repository", Path.GetDirectoryName(path) ?? "", target))
            return full.StartsWith("/repository/", StringComparison.Ordinal) ? full.Substring(12): ""
        }

        private func Text(repo string, revision string, path string, tree Dictionary[string, JsonElement]) string {
            let seen = HashSet[string]()
            var resolved = path
            while tree.ContainsKey(resolved) && seen.Add(resolved) {
                let blob = GitHub.Api("repos/" + repo + "/git/blobs/" + J.Text(tree[resolved], "sha"))
                let text = Encoding.UTF8.GetString(Convert.FromBase64String(J.Text(blob, "content")))
                if J.Text(tree[resolved], "mode") != "120000" {
                    return text
                }
                resolved = Relative(resolved, text.Trim())
            }
            throw CliFailure("invalid_state", "Guidance link leaves the repository or cycles")
        }

        internal func Find(repo string, revision string) Dictionary[string, Object?] {
            let response = GitHub.Api("repos/" + repo + "/git/trees/" + revision + "?recursive=1")
            if J.Bool(response, "truncated") {
                throw CliFailure("invalid_state", "Repository guidance tree is incomplete")
            }
            let tree = Dictionary[string, JsonElement](StringComparer.Ordinal)
            for entry in J.Items(J.Get(response, "tree")) {
                if J.Text(entry, "type") == "blob" {
                    tree[J.Text(entry, "path")] = entry
                }
            }
            let paths = List[string](tree.Keys)
            let ordered = paths
                .Where(path -> Rank(path) >= 0)
                .OrderBy(path -> Rank(path))
                .ThenBy(path -> path, StringComparer.Ordinal)
                .ToList()
            let guidance = Dictionary[string, Object?]()
            var index int32
            while index < ordered.Count {
                let path = ordered[index]
                index++
                let text = Text(repo, revision, path, tree)
                Add(guidance, path, text)
                for token in text.Split(" \t\r\n()<>\"`".ToCharArray(), StringSplitOptions.RemoveEmptyEntries) {
                    let linked = Relative(path, Uri.UnescapeDataString(token.Split('#')[0]))
                    if tree.ContainsKey(linked) && !ordered.Contains(linked) {
                        ordered.Add(linked)
                    }
                }
            }
            for path in paths {
                if Path.GetDirectoryName(path) != "" || !Path.GetFileNameWithoutExtension(path).Equals(
                    "readme",
                    StringComparison.OrdinalIgnoreCase
                ) {
                    continue
                }
                let lines = Text(repo, revision, path, tree).Split('\n')
                let start = Array.FindIndex(
                    lines,
                    line -> line.TrimStart().StartsWith('#') && line.Contains(
                        "contribut",
                        StringComparison.OrdinalIgnoreCase
                    )
                )
                if start < 0 {
                    continue
                }
                let level = lines[start].TrimStart().TakeWhile(c -> c == '#').Count()
                var section = lines[start] + "\n"
                for index in start + 1 ... lines.Length {
                    let depth = lines[index].TrimStart().TakeWhile(c -> c == '#').Count()
                    if depth > 0 && depth <= level {
                        break
                    }
                    section += lines[index] + "\n"
                }
                Add(guidance, path + " (contributing section)", section)
            }
            return guidance
        }

        private func Rank(path string) int32 {
            let folder = Path.GetDirectoryName(path) ?? ""
            let name = Path.GetFileName(path).ToLowerInvariant()
            let names = "contributing contributing.md contributing.rst contributing.txt".Split(' ')
            let rank = Array.IndexOf([]string{"", ".github", "docs"}, folder)
            return switch path {
                case "AGENTS.md": 0
                case "CLAUDE.md": 2
                case ".github/copilot-instructions.md": 3
                default: path.EndsWith("/AGENTS.md", StringComparison.Ordinal) ? 1: rank >= 0 && Array.IndexOf(
                    names,
                    name
                ) >= 0 ? 4 +
                    rank: -1
            }
        }

        private func Add(guidance Dictionary[string, Object?], path string, text string) {
            if Encoding.UTF8.GetByteCount(text) > 32768 {
                throw CliFailure("invalid_state", "Guidance text exceeds 32 KiB: " + J.Write(path))
            }
            guidance[path] = text
        }
    }
}
