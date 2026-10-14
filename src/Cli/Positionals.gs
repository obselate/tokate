package Tokate

import System
import System.Collections.Generic
import System.Text.RegularExpressions

internal class Positionals {
    shared {
        internal let AccessOperations[]string = []string{
            "list",
            "history",
            "init",
            "trust",
            "untrust",
            "grant",
            "remove",
            "deny",
            "restore",
            "check",
            "request"
        }

        private func Limit(args Args, count int32) {
            if args.Words.Count > count {
                throw Exception("Unexpected argument: " + args.Words[count])
            }
        }

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
                throw Exception("Invalid positive number: " + Cli.Label(key))
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
                throw Exception("Use a GitHub " + key + " URL: https://github.com/OWNER/REPO/" + segment + "/N")
            }

            Repo(args, match.Groups[1].Value)
            Number(args, key, match.Groups[2].Value)
        }

        internal func Reference(args Args, word string, key string) {
            if args.Command == "verify" && word.Contains("/issues/") {
                throw Exception("verify takes an open contribution PR, for example tokate verify 42.")
            }

            let segment = key == "pr" ? "pull": "issues"
            if key != "repo" && word.Contains("://") && word.Contains("/" + segment + "/") {
                Url(args, word, key, segment)

                return
            }

            let match = Regex.Match(word, "^(?:([^#]+)#)?([0-9]+)(?:-([0-9]+))?\\z")
            let attempt = match.Groups[3].Value

            if key != "repo" && match.Success && (attempt == "" || Cli.Find(args.Command).Runs) {
                if match.Groups[1].Value != "" {
                    Repo(args, match.Groups[1].Value)
                }

                Number(args, attempt == "" ? key: "issue", match.Groups[2].Value)

                if attempt != "" {
                    Number(args, "attempt", attempt)
                }

                return
            }

            if key != "repo" && !word.Contains("/") {
                throw Exception(
                    "Use " + Cli.Label(key) + " as a number, OWNER/REPO#N or a GitHub URL; unexpected: " + word
                )
            }

            Repo(args, word)
        }

        private func Access(args Args) {
            let words = args.Words
            let operation = words.Count == 0 ? "list": words[0]

            if Array.IndexOf(AccessOperations, operation) < 0 {
                throw Exception(
                    "Unknown access operation: " + operation + ". Use " + String.Join(", ", AccessOperations)
                )
            }

            args.Values["--operation"] = operation

            if args.Get("trust") == "true" {
                args.Values["--scope"] = "trust"
            }

            let donor = operation == "trust" ||
                operation == "untrust" ||
                operation == "deny" ||
                operation == "restore" ||
                operation == "grant" ||
                operation == "remove"
            let filter = operation == "list" || operation == "history"
            let issue = operation == "grant" || operation == "remove" || operation == "check" || operation == "request"
            Limit(args, donor || filter ? 3: 2)

            var i int32 = 1

            if words.Count > i && (donor || (filter && !words[i].Contains("/"))) {
                args.Values["--donor"] = words[i]
                i++
            }

            if words.Count > i {
                Reference(args, words[i], issue ? "issue": "repo")

                if issue && args.Get("issue") == "" {
                    throw Exception("Expected ISSUE for access " + operation)
                }

                i++
            }

            if words.Count > i {
                throw Exception("Unexpected argument: " + words[i])
            }
        }

        private func Doctor(args Args) {
            Limit(args, 2)

            for word in args.Words {
                if word == "owner" || word == "managed" || word == "external" {
                    if args.Get("owner") + args.Get("managed") + args.Get("external") != "" {
                        throw Exception("Choose one doctor scope: owner, managed or external")
                    }

                    args.Values["--" + word] = "true"
                } else if args.Get("owner") == "true" {
                    Repo(args, word)
                } else if args.Get("harness") != "" {
                    throw Exception("Unexpected argument: " + word)
                } else {
                    args.Values["--harness"] = word
                }
            }
        }

        internal func Bind(args Args) {
            let words = args.Words
            let target = Cli.Find(args.Command).Target

            if target == "subject" {
                Limit(args, 1)
                args.Subject = words.Count == 0 ? "": words[0]

                if args.Command == "help" && args.Subject != "" {
                    Cli.Find(args.Subject)
                }
            } else if target == "defaults" {
                Limit(args, 2)
                args.Subject = words.Count == 0 ? "list": words[0]

                if words.Count > 1 {
                    args.Values["--profile"] = words[1]
                }
            } else if target == "doctor" {
                Doctor(args)
            } else if target == "access" {
                Access(args)
            } else if target == "prs" {
                let prs = List[string]()
                var i int32 = 0

                while i < words.Count {
                    Reference(args, words[i], "pr")
                    prs.Add(args.Get("pr"))
                    args.Values.Remove("--pr")
                    i++
                }

                args.Values["--prs"] = String.Join(",", prs)
            } else if target == "repo" && args.Command == "select" {
                Limit(args, 2)

                if words.Count == 1 && !words[0].Contains("/") {
                    args.Values["--profile"] = words[0]
                } else if words.Count > 0 {
                    Reference(args, words[0], "repo")

                    if words.Count > 1 {
                        args.Values["--profile"] = words[1]
                    }
                }
            } else if target == "repo" {
                Limit(args, 1)

                if words.Count == 1 {
                    Reference(args, words[0], target)
                }
            } else {
                let profileOperand = args.Command == "work" || args.Command == "claim" || args.Command == "prepare"
                Limit(args, profileOperand ? 2: (target == "" ? 0: 1))

                if words.Count > 0 {
                    let reference = args.Command == "work" && words[0].Contains("://") ? "repo":
                    target == "run" ? "issue": target
                    Reference(args, words[0], reference)

                    if args.Command == "work" && args.Get("issue") == "" && words.Count > 1 && words[1] == "stop" {
                        args.Subject = "stop"
                    } else if words.Count > 1 {
                        if args.Get("issue") == "" || args.Get("attempt") != "" || args.Get("run") != "" {
                            throw Exception("A profile name must follow an issue number")
                        }

                        args.Values["--profile"] = words[1]
                    }
                }
            }

            if LeaseLifecycle.Transition(args.Command) {
                args.Values["--operation"] = args.Command
            }
        }
    }
}
