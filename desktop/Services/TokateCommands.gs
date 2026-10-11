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
                if draft.Harness == "pi" && draft.Endpoint.Trim() != "" {
                    args.Add("--endpoint")
                    args.Add(draft.Endpoint.Trim())
                }
            }
            args.Add("--non-interactive")
            return args
        }

        func DefaultsList() []string -> []string{"defaults", "list"}

        func Policy(repo string) []string -> []string{"policy", repo}

        func Status(run string) []string -> []string{"status", "--run", run}

        func IssueStatus(repo string, issue string) []string -> []string{"status", repo + "#" + issue}

        func Work(run string) []string -> []string{"work", "--run", run, "--yes"}

        func Coordination(repo string, issue string) []string -> []string{"coordination", repo + "#" + issue}

        func OwnerDoctor() []string -> []string{"doctor", "owner", "--auth"}

        func Approve(repo string, issue string, branch string) []string ->
        []string{"approve", repo + "#" + issue, "--base-branch", branch}

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

        func SetupModelsJson(draft SetupDraft) string -> draft.ModelPolicy == "whitelist" ? Json.StringListMap(
            draft.Models
        ): draft.ModelsJson

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
            if draft.ModelPolicy != "" {
                args.Add("--model-policy")
                args.Add(draft.ModelPolicy)
            }
            if draft.Minutes != "" {
                args.Add("--max-time")
                args.Add((draft.MinutesSeconds() / 60).ToString() + "m")
            }
            let models = SetupModelsJson(draft)
            if models.Trim() != "" {
                args.Add("--models")
                args.Add(models)
            }
            if draft.Tools.Trim() != "" {
                args.Add("--allowed-tools")
                args.Add(draft.Tools)
            }
            if draft.Eligibility.Trim() != "" {
                args.Add("--eligibility")
                args.Add(draft.Eligibility)
            }
            return args.ToArray()
        }

        /// `published` is the candidate commit that the run already published.
        func RunAction(action RunAction, run string, amendment AmendmentDraft, published string = "") []string {
            let args = List[string]{RunActions.Command(action), "--run", run}
            if RunActions.NeedsBudget(action) {
                args.Add("--time")
                args.Add(amendment.VerificationMinutes().ToString() + "m")
            }
            if action == RunAction.Amend {
                args.Add("--commit")
                args.Add(amendment.ValidCommit(published))
                if amendment.Summary != "" {
                    args.Add("--summary")
                    args.Add(amendment.Summary)
                }
                if amendment.Tools != "" {
                    args.Add("--tools")
                    args.Add(amendment.Tools)
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

        func Repository(repo string) []string -> []string{"api", "repos/" + repo}

        /// The public repositories of the user, the last pushed first.
        func Repositories() []string -> []string{"api", "user/repos?visibility=public&sort=pushed&per_page=30"}

        func Issue(repo string, number string) []string -> []string{"api", "repos/" + repo + "/issues/" + number}

        func PullRequest(repo string, pr string) []string ->
        []string{"pr", "view", pr, "--repo", repo, "--json", "state,reviewDecision,statusCheckRollup,url"}

        func SearchIssues(repo string, listing IssueListing, page int32) []string {
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
                "per_page=" + IssueListing.PageSize.ToString(),
                "-f",
                "page=" + page.ToString(),
            }
        }
    }
}

class CodexCommands {
    shared {
        func BundledModels() []string -> []string{"debug", "models", "--bundled"}
    }
}
