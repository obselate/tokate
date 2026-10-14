package Tokate

import System
import System.Collections.Generic
import System.ComponentModel
import System.IO
import System.Text
import System.Text.RegularExpressions

internal class RepositoryInput {
    shared {
        internal func Repo(value string) string {
            var normalized = value

            if value.Contains("://") {
                let uri = Uri(value)
                if !String.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase) {
                    throw Exception("Use a github.com repository URL")
                }

                normalized = Regex.Match(uri.AbsolutePath, "^/([^/]+/[^/]+)(?:/|$)").Groups[1].Value

                if normalized.EndsWith(".git") {
                    normalized = normalized.Substring(0, normalized.Length - 4)
                }
            }

            return RepositoryIdentity.Repo(normalized)
        }

        internal func Local(cwd string = "") string {
            var result CommandResult

            try {
                result = Commands.Run(
                    "git",
                    []string{"-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "remote", "-v"},
                    cwd: cwd,
                    seconds: 5
                )
            } catch (error Win32Exception) {
                throw Exception("Local Git is unavailable; name OWNER/REPO or OWNER/REPO#42")
            }

            if result.Code != 0 {
                throw Exception("Cannot determine a local repository; name OWNER/REPO or OWNER/REPO#42")
            }

            var repo string = ""
            for line in result.Output.Split('\n', StringSplitOptions.RemoveEmptyEntries) {
                let fields = line.Split([]char{' ', '\t'}, StringSplitOptions.RemoveEmptyEntries)
                let url = fields.Length >= 2 ? fields[1]: ""
                let match = Regex.Match(
                    url,
                    "^(?:https://github\\.com/|git@github\\.com:|ssh://git@github\\.com/)([A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*?)(?:\\.git)?/?$",
                    RegexOptions.IgnoreCase
                )

                if !match.Success {
                    continue
                }

                let candidate = RepositoryIdentity.Repo(match.Groups[1].Value)

                if repo != "" && !String.Equals(repo, candidate, StringComparison.OrdinalIgnoreCase) {
                    throw Exception("Ambiguous local remotes; name OWNER/REPO or OWNER/REPO#42")
                }

                repo = candidate
            }

            if repo == "" {
                throw Exception("No GitHub remote found; name OWNER/REPO or OWNER/REPO#42")
            }

            return repo
        }
    }
}
