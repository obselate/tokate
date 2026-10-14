package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Net.Http
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

internal class GratisGuidance {
    shared {
        internal func Discover(repo string, revision string) JsonElement {
            let tree = GitHub.Api("repos/" + repo + "/git/trees/" + revision + "?recursive=1")
            if J.Get(tree, "truncated").ValueKind != JsonValueKind.False || J.Get(tree, "tree")
                .ValueKind != JsonValueKind.Array {
                throw CliFailure("invalid_state", "Repository guidance discovery is incomplete")
            }
            let paths = SortedDictionary[string, JsonElement](StringComparer.Ordinal)
            for entry in J.Items(J.Get(tree, "tree")) {
                paths[J.Text(entry, "path")] = entry
            }
            let names = List[string]()
            for name in[]string{"AGENTS.md", "CLAUDE.md"} {
                if paths.ContainsKey(name) {
                    names.Add(name)
                }
                for path in paths.Keys {
                    if path.EndsWith("/" + name, StringComparison.Ordinal) {
                        names.Add(path)
                    }
                }
            }
            for name in[]string{
                ".github/copilot-instructions.md",
                "CONTRIBUTING.md",
                ".github/CONTRIBUTING.md",
                "docs/CONTRIBUTING.md"
            } {
                if paths.ContainsKey(name) {
                    names.Add(name)
                }
            }
            let primaryCount = names.Count
            let files = List[Object]()
            let seen = HashSet[string](StringComparer.Ordinal)
            var bytes int32
            var blocked = ""
            var ready bool
            var draftRequired bool
            var discussions bool
            var discussionsForbidden bool
            let checks = List[Object]()
            let commands = HashSet[string](StringComparer.Ordinal)
            var index int32
            var readme bool
            while index < names.Count || !readme {
                if index == names.Count {
                    readme = true
                    if !paths.ContainsKey("README.md") {
                        break
                    }
                    names.Add("README.md")
                }
                let name = names[index++]
                if !seen.Add(name) {
                    continue
                }
                let entry = paths[name]
                if J.Text(entry, "type") != "blob" ||
                    (J.Text(entry, "mode") != "100644" && J.Text(entry, "mode") != "100755") ||
                    J.Number(entry, "size") > 65536 {
                    throw CliFailure("invalid_state", "Unsupported guidance file: " + name)
                }
                var text = GitHub.FileAt(repo, name, revision)
                if name == "README.md" {
                    let section = Regex.Match(text, "(?im)^#{1,6}[^\\r\\n]*contribut[^\\r\\n]*\\r?\\n")
                    if !section.Success {
                        continue
                    }
                    var depth int32
                    while section.Value[depth] == '#' {
                        depth++
                    }
                    let rest = text.Substring(section.Index + section.Length)
                    let end = Regex.Match(rest, "(?m)^#{1," + depth.ToString() + "} ")
                    text = section.Value + (end.Success ? rest.Substring(0, end.Index): rest)
                }
                bytes += Encoding.UTF8.GetByteCount(text)
                if bytes > 1048576 || files.Count == 128 {
                    throw CliFailure("invalid_state", "Repository guidance exceeds the discovery limit")
                }
                let restriction = Restriction(text)
                if restriction != "" {
                    blocked = name + ": " + restriction
                }
                ready = ready || Regex.IsMatch(
                    text,
                    "(?i)(?:open|submit|create|publish)\\s+(?:a\\s+|an\\s+)?(?:ready|non-draft)\\s+(?:PR|pull request)"
                )
                discussions = discussions || Regex.IsMatch(
                    text,
                    "(?i)(?:post|publish|share|submit)\\s+[^.\\n]{0,120}(?:in|to|as)\\s+(?:a\\s+|GitHub\\s+)?discussion|authoriz\\w*[^.]{0,120}discussion\\s+posts"
                )
                draftRequired = draftRequired || Regex.IsMatch(
                    text,
                    "(?i)(?:open|submit|create|publish|require)\\s+(?:a\\s+|an\\s+|all\\s+|only\\s+)?draft\\s+(?:PR|pull request)|(?:PRs?|pull requests?)\\s+(?:must|should)\\s+be\\s+draft|(?:do not|never|must not)[^.\\n]{0,60}(?:ready|non-draft)"
                )
                discussionsForbidden = discussionsForbidden || Regex.IsMatch(
                    text,
                    "(?i)(?:do not|never|must not)[^.\\n]{0,100}discussion|no\\s+(?:AI\\s+)?discussions"
                )
                let found = TestCommands(text)
                for command in found {
                    if commands.Add(command) {
                        checks.Add([]string{"sh", "-ec", command})
                    }
                }
                files.Add(
                    map[string, Object?]{
                        "path": name,
                        "text": text,
                        "sha256": Data.Hash(text),
                        "authorization": restriction != "" ? restriction: "Follow the task and contribution rules below; draft PR by default",
                        "test_commands": found
                    }
                )
                if index > primaryCount {
                    continue
                }
                for match in Regex.Matches(text, "\\[[^\\]]*\\]\\(([^ )]+)(?:[^)]*)\\)") {
                    let link = Uri.UnescapeDataString(match.Groups[1].Value.Split('#')[0])
                    if link == "" || link.Contains(':') || link.StartsWith("/") || link.Contains('\\') {
                        continue
                    }
                    let root = "/tokate-guidance"
                    let path = Path.GetFullPath(Path.Combine(root, Path.GetDirectoryName(name) ?? "", link))
                    if path.StartsWith(root + "/", StringComparison.Ordinal) {
                        let relative = path.Substring(root.Length + 1)
                        if paths.ContainsKey(relative) && Regex.IsMatch(relative, "(?i)\\.(md|rst|txt)$") {
                            names.Add(relative)
                        }
                    }
                }
            }
            return J.Parse(
                J.Write(
                    map[string, Object?]{
                        "files": files,
                        "blocked": blocked,
                        "ready_prs": ready && !draftRequired,
                        "discussions": discussions && !discussionsForbidden,
                        "verification": checks
                    }
                )
            )
        }

        private func Restriction(text string) string {
            let normalized = Regex.Replace(text, "[*_`\\r\\n]+", " ")
            let ai = "(?:AI|LLM|machine|bot|artificial intelligence|auto(?:mated)?(?:ly)?)"
            if Regex.IsMatch(
                normalized,
                "(?i)(?:no|forbid\\w*|disallow\\w*|reject\\w*|do not submit|do not use|do not send|do not accept|not accept|not allow|not welcome|prohibit\\w*)[^.!?]{0,100}\\b" +
                    ai +
                    "\\b"
            ) ||
                Regex
                .IsMatch(
                normalized,
                "(?i)\\b" + ai + "\\b[^.!?]{0,100}(?:forbidden|prohibited|not accepted|not allowed|not welcome)"
            ) {
                return "AI contributions are forbidden"
            }
            if Regex.IsMatch(
                normalized,
                "(?i)(?:require\\w*|obtain|seek|request|get|need|must have)[^.!?]{0,80}(?:(?:prior|advance)[^.!?]{0,40}approval|approval[^.!?]{0,80}(?:first|before|prior))"
            ) ||
                Regex
                .IsMatch(
                normalized,
                "(?i)(?:prior|advance|maintainer|owner)[^.!?]{0,40}approval[^.!?]{0,60}(?:required|before|must)|(?:ask|contact)[^.!?]{0,60}(?:first|before (?:work|contribut|start|open))"
            ) {
                return "Contributions require approval first"
            }
            if Regex.IsMatch(
                normalized,
                "(?i)(?:auto[- ]?clos\\w*|automatically clos\\w*)[^.!?]{0,100}(?:new|first[- ]time) contribut|(?:new|first[- ]time) contribut[^.!?]{0,100}(?:auto[- ]?clos\\w*|automatically clos\\w*)"
            ) {
                return "New contributor work is automatically closed"
            }
            return ""
        }

        private func TestCommands(text string) List[string] {
            let commands = List[string]()
            var testing bool
            var named bool
            var fence bool
            var capture bool
            var block = ""
            for line in text.Split('\n') {
                let clean = line.Trim()
                if clean.StartsWith("```") {
                    if fence && capture && block.Trim() != "" {
                        commands.Add(block.Trim())
                    }
                    capture = testing || named
                    block = ""
                    fence = !fence
                    named = false
                    continue
                }
                if fence {
                    if capture {
                        block += (clean.StartsWith("$ ") ? clean.Substring(2): line) + "\n"
                    }
                    continue
                }
                if clean.StartsWith("#") {
                    testing = Regex.IsMatch(
                        clean,
                        "(?i)^#+\\s+(?:(?:running|run)\\s+(?:the\\s+)?)?(?:tests?|testing|verification|checks?)(?:\\s|$)"
                    )
                    named = false
                }
                if Regex.IsMatch(clean, "(?i)test|verif|check") {
                    named = Regex.IsMatch(clean, "(?i)\\b(?:run|execute|use)\\b|(?:test|verification|check) command") &&
                        !Regex.IsMatch(clean, "(?i)historical|do not|never|not run")
                    for match in Regex.Matches(clean, "`([^`\\r\\n]+)`") {
                        let command = match.Groups[1].Value
                        if named &&
                            (
                            Regex.IsMatch(clean, "(?i)(?:test|verification|check) command") || Regex.IsMatch(
                                command,
                                "^(?:bash |sh |python[0-9.]* |pytest(?: |$)|npm |pnpm |yarn |cargo |go |make(?: |$)|dotnet |test |\\./)"
                            )
                        ) {
                            commands.Add(command)
                        }
                    }
                }
            }
            if fence && capture {
                throw CliFailure("invalid_state", "Unclosed repository verification command block")
            }
            return commands
        }

        internal func Prompt(source string) string {
            var text = "Choose one useful task under the repository contribution guidance. If there is no guidance, implement the eligible issue selected by Tokate."
            if source != "" {
                if source.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || source.StartsWith(
                    "http://",
                    StringComparison.OrdinalIgnoreCase
                ) {
                    using let client = HttpClient()
                    client.Timeout = TimeSpan.FromSeconds(30)
                    var url = source
                    if Regex.IsMatch(url, "^https://gist\\.github\\.com/[^/]+/[a-fA-F0-9]+/?$") {
                        url = url.Replace("gist.github.com/", "gist.githubusercontent.com/").TrimEnd('/') + "/raw"
                    }
                    client.MaxResponseContentBufferSize = 65536
                    text = client.GetStringAsync(url).GetAwaiter().GetResult()
                } else {
                    if source.Contains("://") || FileInfo(source).Length > 65536 {
                        throw CliFailure("invalid_arguments", "Use an HTTP or HTTPS prompt or a file of at most 64 KiB")
                    }
                    text = File.ReadAllText(source, UTF8Encoding(false, true))
                }
            }
            if String.IsNullOrWhiteSpace(text) || text.Contains('\0') {
                throw CliFailure("invalid_arguments", "Task prompt must contain text without NUL")
            }
            return text
        }

        internal func Consent(guidance JsonElement) string {
            var result = "\nGratis mode: no owner approved the task."
            for file in J.Items(J.Get(guidance, "files")) {
                result += "\nGuidance: " + J.Text(file, "path") + "\n" + J.Text(file, "authorization") + "\n" + J.Text(
                    file,
                    "text"
                )
            }
            result += J.Bool(guidance, "ready_prs") ? "\nGuidance permits ready PRs.": "\nPRs are drafts."
            result += J.Bool(
                guidance,
                "discussions"
            ) ? "\nGuidance permits one findings Discussion post per task.": "\nFindings stay private."
            return result
        }
    }
}
