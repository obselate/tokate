package TokateDesktop

import System
import System.Collections.Generic

/// The profiles that the donor saved with Tokate, and the form that adds or changes one.
data struct ProfilesState {
    var Profiles []DonorProfile
    var Loaded bool
    var Models []ModelChoice
    var OmpModels []ModelChoice
    /// The harnesses that are not set up on this computer.
    var Unready []string
    /// Whether the form shows.
    var Open bool
    /// The saved profile that the form changes, or "" for a new profile.
    var Editing string
    var Name string
    var Draft DonationDraft

    func Catalog() []ModelChoice -> ModelChoice.Catalog(Draft.Harness, Draft.Provider, Models, OmpModels, Policy.Empty)

    func Providers() []string {
        let providers = List[string](ModelChoice.Providers(OmpModels))
        providers.Add("local-chat-completions")
        return providers.ToArray()
    }

    func Efforts() []string -> Draft.EffortChoices(Catalog())

    /// What stops the form from saving, or "".
    func Problem() string {
        if Name.Trim() == "" {
            return "Enter a profile name."
        }
        if (Draft.Harness == "omp" || Draft.Harness == "command") && Draft.Provider.Trim() == "" {
            return "Enter the provider."
        }
        if Draft.Model.Trim() == "" {
            return "Select the model."
        }
        if Draft.Effort == "" {
            return "Select a reasoning effort."
        }
        if Draft.Harness == "pi" && Draft.Endpoint.Trim() == "" {
            return "Enter the local endpoint. Tokate does not show a saved endpoint, so enter it again for each change."
        }
        return ""
    }

    shared {
        let Initial ProfilesState = ProfilesState{
            Profiles: []DonorProfile{},
            Models: []ModelChoice{},
            OmpModels: []ModelChoice{},
            Unready: []string{},
            Editing: "",
            Name: "",
            Draft: DonationDraft.Initial,
        }
    }
}
