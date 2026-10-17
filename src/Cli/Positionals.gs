package Tokate

import System
import System.Collections.Generic
import System.Linq
import System.Text.RegularExpressions

internal class Positionals {
    shared {
        private func Repo(args Args, value string) {
            let repo = RepositoryInput.Repo(value)

            if args.Get("repo") != "" && !String.Equals(
                RepositoryInput.Repo(args.Get("repo")),
                repo,
                StringComparison.OrdinalIgnoreCase
            ) {
                throw Exception("Repository arguments conflict")
            }

            args.Values["--repo"] = repo
        }

        private func Number(args Args, key string, value string) {
            var parsed int32

            if !Int32.TryParse(value, out parsed) || parsed < 1 {
                throw Exception("Invalid positive number: " + Args.Label(key))
            }

            args.Values["--" + key] = parsed.ToString()
        }

        private func Url(args Args, value string, key string, segment string) {
            let uri = Uri(value)
            let match = Regex.Match(
                uri.AbsolutePath,
                "^/([A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*)/" + segment + "/([0-9]+)/?$"
            )

            if uri.Scheme != "https" || !String.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase) ||
                !uri.IsDefaultPort ||
                uri.UserInfo != "" ||
                !match.Success {
                throw Exception("Use a GitHub " + key + " URL: " + GitHub.WebUrl + "OWNER/REPO/" + segment + "/N")
            }

            Repo(args, match.Groups[1].Value)
            Number(args, key, match.Groups[2].Value)
        }

        internal func Reference(args Args, word string, key string) {
            let segment = key == "pr" ? "pull": "issues"
            if key != "repo" && word.Contains("://") && (word.Contains("/issues/") || word.Contains("/pull/")) {
                Url(args, word, key, segment)

                return
            }

            if args.Command == "work" && key == "issue" && word.Contains(",") {
                let parts = word.Split('#')
                if parts.Length > 2 {
                    throw Exception("Use OWNER/REPO#N,N for an issue list")
                }
                if parts.Length == 2 {
                    Repo(args, parts[0])
                }
                let numbers = List[string]()
                for value in parts[parts.Length - 1].Split(',') {
                    Number(args, "issue", value)
                    if numbers.Contains(args.Get("issue")) {
                        throw Exception("Duplicate issue: #" + args.Get("issue"))
                    }
                    numbers.Add(args.Get("issue"))
                }
                args.Values.Remove("--issue")
                args.Values["--issues"] = String.Join(",", numbers)
                return
            }

            let match = Regex.Match(word, "^(?:([^#]+)#)?([0-9]+)(?:-([0-9]+))?\\z")
            let attempt = match.Groups[3].Value

            if key != "repo" && match.Success && (attempt == "" || Cli.Find(args.Command).Runs) {
                let repo = match.Groups[1].Value
                if repo != "" {
                    Repo(args, repo.Contains("/") || !Cli.Find(args.Command).Runs ? repo: RunReference.Repo(repo))
                }

                Number(args, attempt == "" ? key: "issue", match.Groups[2].Value)

                if attempt != "" {
                    Number(args, "attempt", attempt)
                }

                return
            }

            if key != "repo" && !word.Contains("/") {
                throw Exception(
                    "Use " + Args.Label(key) + " as a number, OWNER/REPO#N or a GitHub URL; unexpected: " + word
                )
            }

            Repo(args, word)
        }

        private func Fits(slot string, word string) bool {
            let kind = slot.Trim('[', ']')

            if Cli.Literal(kind) {
                return kind.Split('|').Contains(word)
            }

            if kind == "OWNER/REPO" || kind == "NAME" || kind == "LOGIN" || kind == "HARNESS" {
                return word.Contains("/") == (kind == "OWNER/REPO")
            }

            return true
        }

        private func Match(form List[string], words List[string]) List[KeyValuePair[string, int32]]? {
            let pairs = List[KeyValuePair[string, int32]]()
            var i int32 = 0

            for slot in form {
                let literal = Cli.Literal(slot)
                let optional = slot.StartsWith("[")

                if i < words.Count && Fits(slot, words[i]) {
                    pairs.Add(KeyValuePair[string, int32](slot, i))
                    i = slot == "PR..." ? words.Count: i + 1
                } else if i < words.Count ? literal || !optional: literal && !optional {
                    return nil
                } else {
                    pairs.Add(KeyValuePair[string, int32](slot, -1))
                }
            }

            return i == words.Count ? pairs: nil
        }

        internal func Bind(args Args) {
            if args.Command == "clean" {
                return
            }

            let words = args.Words
            let forms = Cli.Find(args.Command).Forms
            let pairs = forms
                .Where(form -> form.Any(Cli.Literal))
                .Concat(forms.Where(form -> !form.Any(Cli.Literal)))
                .Select(form -> Match(form, words))
                .FirstOrDefault(matched -> matched != nil)

            if pairs == nil {
                if words.Count > 0 {
                    throw Exception("Unexpected arguments: " + String.Join(" ", words))
                }

                return
            }

            for pair in pairs {
                let kind = pair.Key.Trim('[', ']')

                if pair.Value < 0 {
                    if Cli.Literal(kind) && args.Subject == "" {
                        args.Subject = kind.Split('|')[0]
                    }

                    continue
                }

                let word = words[pair.Value]

                if Cli.Literal(kind) {
                    args.Subject = word
                } else if kind == "COMMAND" {
                    Cli.Find(word)
                    args.Subject = word
                } else if kind == "NAME" {
                    args.Values["--profile"] = word
                } else if kind == "LOGIN" {
                    args.Values["--donor"] = word
                } else if kind == "HARNESS" {
                    if args.Get("harness") != "" {
                        throw Exception("Duplicate option: --harness")
                    }

                    args.Values["--harness"] = word
                } else if kind == "PR..." {
                    let prs = List[string]()

                    for item in words.Skip(pair.Value) {
                        Reference(args, item, "pr")
                        prs.Add(args.Get("pr"))
                        args.Values.Remove("--pr")
                    }

                    args.Values["--prs"] = String.Join(",", prs)
                } else {
                    Reference(
                        args,
                        word,
                        kind.Contains("PR") ? "pr": kind.Contains("ISSUE") || kind == "RUN" ? "issue": "repo"
                    )
                }
            }

            if args.Get("profile") != "" && pairs[0].Key.Contains("ISSUE") &&
                (args.Get("issue") == "" || args.Get("attempt") != "") {
                throw Exception("A profile name must follow an issue number")
            }
        }
    }
}
