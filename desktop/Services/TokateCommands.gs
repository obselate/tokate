package TokateDesktop

import System
import System.Collections.Generic

/// Argument arrays for Tokate 0.4.0. An issue or pull request is named as OWNER/REPO#NUMBER and a time
/// limit takes a unit.
class TokateCommands {
    shared {
        func Select(repo string, draft DonationDraft) []string -> Selection("select", repo, draft).ToArray()

        func Claim(
            repo string,
            draft DonationDraft,
            issue string,
            budgetSeconds int32
        ) []string {
            let args = Selection("claim", repo + "#" + issue, draft)
            if draft.Unlimited {
                args.Add("--unlimited")
            } else {
                args.Add("--time")
                args.Add(budgetSeconds.ToString() + "s")
            }
            args.Add("--verify-time")
            args.Add(int32.Parse(draft.Verification).ToString() + "m")
            return args.ToArray()
        }

        private func Selection(command string, target string, draft DonationDraft) List[string] {
            let args = List[string]{command, target}
            if draft.Profile != "" {
                args.Add(draft.Profile)
            }
            if draft.Profile == "" || command == "claim" {
                args.AddRange([]string{"--harness", draft.Harness, "--model", draft.Model.Trim(), "--effort", draft.Effort.Trim()})
                if draft.Harness == "omp" && draft.Provider != "" {
                    args.Add("--provider")
                    args.Add(draft.Provider)
                }
                if draft.Harness == "pi" && draft.Endpoint.Trim() != "" {
                    args.Add("--endpoint")
                    args.Add(draft.Endpoint.Trim())
                }
            }
            args.Add("--non-interactive")
            return args
        }

        func DefaultsList() []string -> []string{"defaults", "list"}

        /// Saves the harness, model and effort of `draft` as the profile `name`.
        func DefaultsSet(name string, draft DonationDraft) []string {
            let args = Selection("defaults", "set", draft with{Profile = "", Provider = draft.Provider.Trim()})
            args.Insert(2, name)
            args.Remove("--non-interactive")
            return args.ToArray()
        }

        func DefaultsRemove(name string) []string -> []string{"defaults", "remove", name}

        /// Makes the profile `name` the default.
        func DefaultsUse(name string) []string -> []string{"defaults", "use", name}

        /// Removes the default. The profiles stay.
        func DefaultsClear() []string -> []string{"defaults", "remove"}

        func Policy(repo string) []string -> []string{"policy", repo}

        func Status(run string) []string -> []string{"status", "--run", run}

        func IssueStatus(repo string, issue string) []string -> []string{"status", repo + "#" + issue}

        func Work(run string) []string -> []string{"work", "--run", run, "--yes"}

        func Coordination(repo string, issue string) []string -> []string{"coordination", repo + "#" + issue}

        func HarnessDoctor(harness string) []string -> []string{"doctor", "managed", harness}

        func OwnerDoctor(repo string = "") []string -> repo == "" ? []string{"doctor", "owner", "--auth"}:
        []string{"doctor", "owner", repo, "--auth"}

        func CoordinatorSetup(repo string, output string, apply bool = false) []string -> apply ?
        []string{"coordinator-setup", repo, "--output", output, "--non-interactive", "--yes"}:
        []string{"coordinator-setup", repo, "--output", output, "--non-interactive"}

        func Approve(repo string, issue string, branch string) []string ->
        []string{"approve", repo + "#" + issue, "--base-branch", branch, "--yes"}

        func Revoke(repo string, issue string) []string -> []string{"revoke", repo + "#" + issue}

        /// `command` is "verify" for the receipt or "checks" for the CI gates.
        func PullRequestCheck(command string, repo string, pr string) []string -> []string{command, repo + "#" + pr}

        func Access(repo string, operation string, donor string = "", issue string = "") []string {
            let args = List[string]{"access", operation}
            if donor != "" {
                args.Add(donor)
            }
            args.Add(issue == "" ? repo: repo + "#" + issue)
            return args.ToArray()
        }

        func Init(repo string, draft SetupDraft) []string {
            let args = List[string]{"init", repo, "--path", draft.Path, "--non-interactive"}
            if draft.CommandsChanged {
                args.Add("--verification")
                args.Add(Json.NestedArrays(draft.Commands))
            }
            if draft.ChecksChanged {
                args.Add("--required-checks")
                args.Add(Json.StringArray(draft.Checks))
            }
            if draft.Minutes != "" {
                args.Add("--max-time")
                args.Add((draft.MinutesSeconds() / 60).ToString() + "m")
            }
            if draft.PermissionsChanged {
                args.Add("--allowed-tools")
                args.Add(Json.AllowedTools(draft.EffectiveTools(), draft.ToolModels))
            }
            if draft.Eligibility.Trim() != "" {
                args.Add("--eligibility")
                args.Add(draft.Eligibility)
            }
            args.Add("--yes")
            return args.ToArray()
        }

        /// `published` is the candidate commit that the run already published. `files` is the directory that
        /// holds the written amendment files; without it the command has only the commit and budget.
        func RunAction(action RunAction, run string, amendment AmendmentDraft, published string = "", files string = "") []string {
            let args = List[string]{RunActions.Command(action), "--run", run}
            if RunActions.NeedsBudget(action) {
                args.Add("--time")
                args.Add(amendment.VerificationMinutes().ToString() + "m")
            }
            if action == RunAction.Amend {
                args.Add("--commit")
                args.Add(amendment.ValidCommit(published))
                if files != "" {
                    args.Add("--summary")
                    args.Add(RunStore.SummaryFile(files))
                }
                if amendment.Edited != EditedBy.Hand {
                    args.Add("--tools")
                    args.Add(amendment.Edited == EditedBy.Other ? amendment.Tools: RunStore.ToolsFile(files))
                }
            }
            return args.ToArray()
        }

        func RunActionTimeout(action RunAction, amendment AmendmentDraft) int32 ->
        RunActions.NeedsBudget(action) ? amendment.VerificationMinutes() * 60 + 120: 600
    }
}

class GitHubCommands {
    shared {
        func User() []string -> []string{"api", "user"}

        /// Reports the active github.com account and whether its sign-in works.
        func SignIn() []string -> []string{"auth", "status", "--active", "--hostname", "github.com", "--json", "hosts"}

        func Repository(repo string) []string -> []string{"api", "repos/" + repo}

        /// The public repositories of the user, the last pushed first.
        func Repositories() []string -> []string{"api", "user/repos?visibility=public&sort=pushed&per_page=30"}

        func Issue(repo string, number string) []string -> []string{"api", "repos/" + repo + "/issues/" + number}

        func PullRequest(repo string, pr string) []string ->
        []string{"pr", "view", pr, "--repo", repo, "--json", "state,reviewDecision,statusCheckRollup,url"}

        /// One batch of `IssueListing.BatchPages` pages of matching issues.
        func SearchIssues(repo string, listing IssueListing, batch int32) []string {
            let number = listing.RequestedNumber()
            if number > 0 {
                return Issue(repo, number.ToString())
            }
            let query = List[string]{"repo:" + repo, "is:issue", "is:open"}
            if listing.Filter != IssueFilter.All {
                query.Add((listing.Filter == IssueFilter.Approved ? "": "-") + "label:tokate:approved")
            }
            if listing.AppliedQuery != "" {
                query.Add("in:title")
                for term in listing.AppliedQuery.Split([]char{' ', '\t', '\r', '\n'}, StringSplitOptions.RemoveEmptyEntries) {
                    let word = term.Replace("\"", "").Replace("\\", "")
                    if word != "" {
                        query.Add("\"" + word + "\"")
                    }
                }
            }
            return []string{
                "api",
                "search/issues",
                "--method",
                "GET",
                "-f",
                "q=" + String.Join(" ", query),
                "-f",
                "sort=updated",
                "-f",
                "order=desc",
                "-f",
                "per_page=" + (IssueListing.PageSize * IssueListing.BatchPages).ToString(),
                "-f",
                "page=" + batch.ToString(),
            }
        }
    }
}

class OmpCommands {
    shared {
        func Models() []string -> []string{"models", "--json"}
    }
}

class CodexCommands {
    shared {
        func BundledModels() []string -> []string{"debug", "models", "--bundled"}
    }
}
