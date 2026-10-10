package TokateDesktop

import System

data struct ModelAllowance {
    var Model string
    var Efforts []string
}

data struct Policy {
    var Loaded bool
    var Version int32
    var MaxSeconds int32
    var AllowUnlimited bool
    var AllowNetwork bool
    var TargetBranch string
    var RequiredChecks []string
    var Verification [][]string
    var Models []ModelAllowance
    var ModelPolicy string
    var Eligibility string
    var AllowedTools []string

    prop AllowsUnlimited bool -> Version == 2 && AllowUnlimited

    prop SupportsApproval bool -> Version >= 2

    func Exceeds(totalSeconds int32) bool -> totalSeconds > 86400 || (MaxSeconds > 0 && totalSeconds > MaxSeconds)

    shared {
        let Empty Policy = Policy{
            TargetBranch: "",
            RequiredChecks: []string{},
            Verification: [][]string{},
            Models: []ModelAllowance{},
            ModelPolicy: "",
            Eligibility: "",
            AllowedTools: []string{},
        }
    }
}
