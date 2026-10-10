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

data struct IssueWork {
    var Issue string
    var State string
    var Drafts []string
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
    var Network string
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

    func EffectiveNetwork(policy Policy) bool -> Network == "" ? policy.AllowNetwork: Network == "allow"

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
            Network: "",
        }
    }
}

data struct SetupPreview {
    var Arguments []string
    var Text string

    prop Ready bool -> Arguments.Length > 0

    shared {
        let None SetupPreview = SetupPreview{Arguments: []string{}, Text: ""}
    }
}
