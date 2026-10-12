package TokateDesktop

import System
import System.Collections.Generic
import System.IO

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
    var Path string
    var Commands [][]string
    var Checks []string
    var Models []ModelAllowance
    var ModelsJson string
    var ModelPolicy string
    var Tools string
    var Eligibility string
    var Minutes string
    var CommandsChanged bool
    var ChecksChanged bool

    func EffectiveEligibility(policy Policy) string {
        let selected = Eligibility == "" ? policy.Eligibility: Eligibility
        return selected == "" ? "trusted": selected
    }

    func EffectiveModelPolicy(policy Policy) string -> ModelPolicy == "" ? policy.ModelPolicy: ModelPolicy

    func EffectiveTools(policy Policy) []string {
        let allowed = List[string]()
        if Tools != "" {
            allowed.AddRange(Tools.Split(','))
        } else {
            allowed.AddRange(policy.AllowedTools)
        }
        if allowed.Count == 0 {
            allowed.Add("codex")
        }
        return allowed.ToArray()
    }

    func MinutesSeconds() int32 {
        if !int32.TryParse(Minutes, out var minutes) || minutes < 1 || minutes > 1440 {
            throw Exception("Enter 1 to 1440 minutes per donation.")
        }
        return minutes * 60
    }

    func CheckedPath() string {
        if !System.IO.Path.IsPathFullyQualified(this.Path) {
            throw Exception("Enter an existing absolute checkout path.")
        }
        return this.Path
    }

    shared {
        func From(policy Policy) SetupDraft -> SetupDraft{
            Path: "",
            Commands: policy.Verification,
            Checks: policy.RequiredChecks,
            Models: policy.Models,
            ModelsJson: "",
            ModelPolicy: policy.Loaded ? "": "unrestricted",
            Tools: "",
            Eligibility: "",
            Minutes: "",
        }
    }
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
    var Work []IssueWork
    var Reviews []DraftReview
    var Access AccessList
    var Selected Issue?
    var Setup SetupDraft
    /// What the CLI reported when setup was last written.
    var Written string

    prop Browsing bool -> Open && Tab == OwnerTab.Contributions && Selected == nil

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
            Setup: SetupDraft.From(Policy.Empty) with{ModelPolicy = ""},
            Written: "",
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
        let All []string = []string{"trusted", "open", "manual"}

        func Label(mode string) string -> mode == "trusted" ? "Trusted donors": mode == "open" ? "Everyone": "Per issue"
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
