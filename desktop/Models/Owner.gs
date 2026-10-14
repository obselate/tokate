package TokateDesktop

import System
import System.Collections.Generic

enum OwnerTab {
    Contributions,
    Access,
    Setup
}

class OwnerTabs {
    shared {
        let All []OwnerTab = []OwnerTab{OwnerTab.Contributions, OwnerTab.Access, OwnerTab.Setup}

        func Label(tab OwnerTab) string -> switch tab {
            case OwnerTab.Access: "Access"
            case OwnerTab.Setup: "Setup"
            default: "Contributions"
        }
    }
}

data struct ProjectInfo {
    var Repository string
    var CanWrite bool
    var Branch string
}

/// A repository the owner can open as a project.
data struct ProjectChoice {
    var Repository string
    var Description string
}

data struct IssueWork {
    var Issue string
    var State string
    var Drafts []string
    var ApprovalStatus string
    var NextAction string

    prop NeedsApproval bool -> ApprovalStatus == "stale"
}

/// The owner's last receipt and CI results for a draft pull request. Empty text means not checked.
data struct DraftReview {
    var Pr string
    var Receipt string
    var Ci string

    prop ReceiptTone Tone -> Receipt == "verified" ? Tone.Done: Receipt == "" ? Tone.Wait: Tone.Fail

    prop CiTone Tone -> Ci == "passed" ? Tone.Done: Ci == "failed" ? Tone.Fail: Ci == NeedsApproval ? Tone.Need: Tone.Wait

    shared {
        /// The CI state when workflow runs wait for the approval of the owner.
        let NeedsApproval string = "needs your approval"
    }
}

data struct AccessRequest {
    var Donor string
    var Issue string
}

data struct AccessMember {
    var Donor string
    var Trusted bool
    var Denied bool

    prop Badge string -> Denied ? "Denied": Trusted ? "Trusted": "Issue access"
}

data struct AccessList {
    var Loaded bool
    var AccessSha string
    var Pending []AccessRequest
    var Members []AccessMember

    shared {
        let Empty AccessList = AccessList{AccessSha: "", Pending: []AccessRequest{}, Members: []AccessMember{}}
    }
}

data struct SetupDraft {
    var Step int32
    var Commands [][]string
    var Checks []string
    var Models []ModelAllowance
    var ModelPolicy string
    var ModelTool string
    var ToolModels []ToolAllowance
    /// The allowed pairs that replace those of the policy, joined with commas, or "" for no change.
    var Tools string
    var Eligibility string
    var Minutes string
    var CommandsChanged bool
    var ChecksChanged bool
    var PermissionsChanged bool

    func EffectiveEligibility(policy Policy) string {
        let selected = Eligibility == "" ? policy.Eligibility: Eligibility
        return selected == "" ? "trusted": selected
    }

    /// The allowed harness and provider pairs, each as "harness/provider". A pair that this app does not
    /// know stays in the list.
    func EffectiveTools() []string {
        let allowed = List[string]()
        if Tools != "" {
            allowed.AddRange(Tools.Split(','))
        } else {
            for tool in ToolModels {
                allowed.Add(tool.Tool)
            }
        }
        if allowed.Count == 0 {
            allowed.Add("codex/openai")
        }
        return allowed.ToArray()
    }

    func MinutesSeconds() int32 {
        if !int32.TryParse(Minutes, out var minutes) || minutes < 1 || minutes > 1440 {
            throw Exception("Enter 1 to 1440 minutes per donation.")
        }
        return minutes * 60
    }

    shared {
        func From(policy Policy) SetupDraft {
            let pairs = policy.Loaded && policy.ToolProviders.Length > 0 ? policy.ToolProviders: []string{"codex/openai"}
            let tools = List[ToolAllowance]()
            for pair in pairs {
                let split = pair.IndexOf('/')
                let declaration = Array.Find(policy.ToolModels, item -> item.Tool == pair)
                tools.Add(ToolAllowance{
                    Tool: pair,
                    Models: policy.ModelsFor(pair.Substring(0, split), pair.Substring(split + 1)),
                    Restricted: policy.RestrictsTool(pair.Substring(0, split), pair.Substring(split + 1)),
                    Command: declaration.Command ?? []string{},
                    Output: declaration.Output ?? "",
                })
            }
            let selected = tools[0]
            return SetupDraft{
                Commands: policy.Verification,
                Checks: policy.RequiredChecks,
                Models: selected.Models,
                ModelPolicy: selected.Restricted ? "whitelist": "unrestricted",
                ModelTool: selected.Tool,
                ToolModels: tools.ToArray(),
                PermissionsChanged: !policy.Loaded,
                Tools: "",
                Eligibility: "",
                Minutes: "",
            }
        }
    }
}

data struct SetupReport {
    var Applied bool
    var Manual []string
    var PullRequest string
}

/// Everything the owner page shows. Text typed into the setup editors lives in their components.
data struct OwnerState {
    var Input string
    var Projects []ProjectChoice
    var ProjectsLoaded bool
    var Open bool
    var Tab OwnerTab
    var Project ProjectInfo
    var Policy Policy
    var PolicyTruncated bool
    var Work []IssueWork
    var Reviews []DraftReview
    var Access AccessList
    var Selected Issue?
    var Setup SetupDraft
    /// The model catalogs of Codex and OMP on this computer, for the setup pickers.
    var Codex []ModelChoice
    var Omp []ModelChoice
    /// Whether the list of OMP providers shows before a provider is allowed.
    var OmpOpen bool
    /// The diagnostics from the last setup preview or apply.
    var Written string
    var SetupPreviewed bool
    var SetupReport SetupReport
    var DoctorReport string

    prop Browsing bool -> Open && Tab == OwnerTab.Contributions && Selected == nil

    /// The OMP providers to offer: those of the policy, of the setup, and of the catalog on this computer.
    func OmpProviders() []string {
        let result = List[string]()
        let pairs = List[string](Policy.ToolProviders)
        pairs.AddRange(Setup.EffectiveTools())
        for pair in pairs {
            if pair.StartsWith("omp/") && !result.Contains(pair.Substring(4)) {
                result.Add(pair.Substring(4))
            }
        }
        for provider in ModelChoice.Providers(Omp) {
            if !result.Contains(provider) {
                result.Add(provider)
            }
        }
        return result.ToArray()
    }

    func ReviewFor(pr string) DraftReview {
        for item in Reviews {
            if item.Pr == pr {
                return item
            }
        }
        return DraftReview{Pr: pr, Receipt: "", Ci: ""}
    }

    func WorkFor(number string) IssueWork? {
        for item in Work {
            if item.Issue == number {
                return item
            }
        }
        return nil
    }

    shared {
        let Initial OwnerState = OwnerState{
            Input: "",
            Projects: []ProjectChoice{},
            Tab: OwnerTab.Contributions,
            Project: ProjectInfo{Repository: "", Branch: ""},
            Policy: Policy.Empty,
            Work: []IssueWork{},
            Reviews: []DraftReview{},
            Access: AccessList.Empty,
            Setup: SetupDraft.From(Policy.Empty),
            Codex: []ModelChoice{},
            Omp: []ModelChoice{},
            Written: "",
            DoctorReport: "",
        }
    }
}

class SetupSteps {
    shared {
        let Names []string = []string{"Checks", "Permissions", "Review"}

        func Next(step int32) string -> step == 0 ? "Set permissions": "Review setup"
    }
}

class Eligibility {
    shared {
        let All []string = []string{"trusted", "open"}

        func Label(mode string) string -> mode == "open" ? "Everyone": "Trusted donors"

        func Detail(mode string) string -> mode == "open" ? "All donors not denied.": "Donors that you trust."
    }
}

class AccessOperations {
    shared {
        func Title(operation string, donor string) string -> operation == "init" ? "Initialize donor access": operation + " " + donor

        func Detail(operation string, issue string) string -> operation == "trust" ?
        "Permit this donor to claim issues with trusted eligibility.": operation == "grant" ?
        "Permit this donor to claim issue #" + issue + ".": "Change this project's donor access."
    }
}
