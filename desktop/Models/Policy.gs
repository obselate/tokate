package TokateDesktop

import System
import System.Collections.Generic

data struct ModelAllowance {
    var Model string
    var Efforts []string
}

data struct Policy {
    var Loaded bool
    var Version int32
    var MaxSeconds int32
    var AllowUnlimited bool
    var TargetBranch string
    var RequiredChecks []string
    var Verification [][]string
    var Models []ModelAllowance
    var ModelPolicy string
    var Eligibility string
    var AllowedTools []string
    /// The allowed tools, each as "harness/provider".
    var ToolProviders []string

    prop AllowsUnlimited bool -> Version == 2 && AllowUnlimited

    prop SupportsApproval bool -> Version >= 2

    /// The providers that the owner allows for `harness`.
    func Providers(harness string) []string {
        let result = List[string]()
        for pair in ToolProviders {
            if pair.StartsWith(harness + "/") && !result.Contains(pair.Substring(harness.Length + 1)) {
                result.Add(pair.Substring(harness.Length + 1))
            }
        }
        return result.ToArray()
    }

    /// Whether a donor can select `harness`.
    func AllowsHarness(harness string) bool -> !Loaded || Providers(harness).Length > 0

    /// Whether the owner allows only the listed models. A policy without the setting is a whitelist.
    prop RestrictsModels bool -> Loaded && ModelPolicy != "unrestricted"

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
            ToolProviders: []string{},
        }
    }
}
