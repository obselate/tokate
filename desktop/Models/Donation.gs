package TokateDesktop

import System
import System.Collections.Generic

enum DonationStep {
    Issue,
    Limits,
    Review,
    Donation
}

class DonationSteps {
    shared {
        let Names []string = []string{"Issue", "Limits", "Review", "Donation"}
        let Numerals []string = []string{"I", "II", "III", "IV"}

        func Index(step DonationStep) int32 -> switch step {
            case DonationStep.Limits: 1
            case DonationStep.Review: 2
            case DonationStep.Donation: 3
            default: 0
        }

        func Heading(step DonationStep) string -> switch step {
            case DonationStep.Issue: "Choose an issue"
            case DonationStep.Limits: "Set your limits"
            case DonationStep.Review: "Review"
            default: "Donation"
        }
    }
}

data struct HarnessOption {
    var Id string
    var Name string
    /// The one provider of the harness, or "" when the owner or donor selects it.
    var Provider string

    shared {
        let All []HarnessOption = []HarnessOption{
            HarnessOption{Id: "codex", Name: "Codex", Provider: "openai"},
            HarnessOption{Id: "claude", Name: "Claude", Provider: "anthropic"},
            HarnessOption{Id: "omp", Name: "OMP", Provider: ""},
            HarnessOption{Id: "pi", Name: "Pi / local", Provider: "local-chat-completions"},
            HarnessOption{Id: "command", Name: "Owner command", Provider: ""},
        }

        func ProviderOf(id string) string {
            for option in All {
                if option.Id == id {
                    return option.Provider
                }
            }
            return ""
        }

        func NameOf(id string) string {
            for option in All {
                if option.Id == id {
                    return option.Name
                }
            }
            return id
        }
    }
}

data struct DonorProfile {
    var Name string
    var Harness string
    var Provider string
    var Model string
    var Effort string
    var Endpoint string
    /// Whether Tokate uses this profile when a command names none.
    var Default bool
}

/// A model that a harness offers, with the reasoning efforts that it supports.
data struct ModelChoice {
    var Slug string
    var DisplayName string
    var Efforts []string
    var Hidden bool
    /// The provider that offers the model. Only OMP models have one.
    var Provider string

    shared {
        /// The Claude models that Tokate accepts. Claude Code has no catalog to read.
        let Claude []ModelChoice = []ModelChoice{
            ClaudeModel("claude-fable-5-1", "Claude Fable 5.1", true),
            ClaudeModel("claude-fable-5", "Claude Fable 5", true),
            ClaudeModel("claude-opus-5-5", "Claude Opus 5.5", true),
            ClaudeModel("claude-sonnet-5-5", "Claude Sonnet 5.5", true),
            ClaudeModel("claude-haiku-5-5", "Claude Haiku 5.5", true),
            ClaudeModel("claude-opus-5", "Claude Opus 5", true),
            ClaudeModel("claude-sonnet-5", "Claude Sonnet 5", true),
            ClaudeModel("claude-opus-4-8", "Claude Opus 4.8", true),
            ClaudeModel("claude-opus-4-7", "Claude Opus 4.7", true),
            ClaudeModel("claude-opus-4-6", "Claude Opus 4.6", false),
            ClaudeModel("claude-sonnet-4-6", "Claude Sonnet 4.6", false),
        }

        private func ClaudeModel(slug string, name string, extraHigh bool) ModelChoice -> ModelChoice{
            Slug: slug,
            DisplayName: name,
            Efforts: extraHigh ? []string{"low", "medium", "high", "xhigh", "max"}: []string{"low", "medium", "high", "max"},
            Provider: "",
        }

        /// A model with its effort, for one line of text.
        func Pair(model string, effort string) string -> effort == "" ? model: model + " / " + EffortLabel(effort)

        /// The name of a harness, with its selected provider.
        func Tool(harness string, provider string) string -> (harness == "omp" || harness == "command") && (provider ?? "") != "" ?
        HarnessOption.NameOf(harness) + " \u00b7 " + provider: HarnessOption.NameOf(harness)

        func EffortLabel(value string) string -> value == "xhigh" ? "Extra high": value == "absent" ? "Not set": value == "" ? "": char.ToUpperInvariant(
            value[0]
        ).ToString() + value.Substring(1)

        /// The harness catalog, limited to owner permissions. Pi and command tools use the owner's
        /// model and effort declarations instead of a catalog.
        func Catalog(harness string, provider string, codex []ModelChoice, omp []ModelChoice, policy Policy) []ModelChoice {
            let offered = harness == "codex" ? codex: harness == "claude" ? Claude: harness == "omp" ? omp: []ModelChoice{}
            let result = List[ModelChoice]()
            let toolProvider = harness == "omp" || harness == "command" ? provider: HarnessOption.ProviderOf(harness)
            let restricted = policy.RestrictsTool(harness, toolProvider)
            let allowances = policy.ModelsFor(harness, toolProvider)
            for model in offered {
                if harness == "omp" && model.Provider != provider {
                    continue
                }
                if !restricted {
                    result.Add(model)
                    continue
                }
                for allowance in allowances {
                    if allowance.Model == model.Slug {
                        let efforts = List[string]()
                        for effort in model.Efforts {
                            if Array.IndexOf(allowance.Efforts, effort) >= 0 {
                                efforts.Add(effort)
                            }
                        }
                        result.Add(model with{Efforts = efforts.ToArray()})
                    }
                }
            }
            if (harness == "pi" || harness == "command") && restricted {
                for allowance in allowances {
                    let slug = allowance.Model
                    if policy.Version >= 3 || (!Array.Exists(codex, model -> model.Slug == slug) && !Array.Exists(Claude, model -> model.Slug == slug)) {
                        result.Add(ModelChoice{Slug: slug, DisplayName: slug, Efforts: allowance.Efforts, Provider: ""})
                    }
                }
            }
            return result.ToArray()
        }

        /// The providers of the OMP models, in the order of the catalog.
        func Providers(omp []ModelChoice) []string {
            let result = List[string]()
            for model in omp {
                if !result.Contains(model.Provider) {
                    result.Add(model.Provider)
                }
            }
            return result.ToArray()
        }
    }
}

data struct DonationDraft {
    var Harness string
    /// The provider of an OMP or command donation.
    var Provider string
    var Model string
    var Effort string
    var Endpoint string
    var Profile string
    var Coding string
    var Unlimited bool
    var Verification string

    func ReserveMinutes() int32 -> int32.TryParse(Verification, out var minutes) ? Math.Max(0, minutes): 0

    func PresetAllowed(minutes int32, policy Policy) bool -> !policy.Exceeds((minutes + ReserveMinutes()) * 60)

    func BudgetSeconds(policy Policy) int32 {
        var minutes int32
        var reserve int32
        if !int32.TryParse(Verification, out reserve) || reserve < 1 || reserve > 1440 {
            throw Exception("Use whole verification minutes from 1 to 1440.")
        }
        if Unlimited && !policy.AllowsUnlimited {
            throw Exception("The owner does not allow unlimited coding.")
        }
        if !Unlimited && (!int32.TryParse(Coding, out minutes) || minutes < 1 || minutes > 1440) {
            throw Exception("Use whole coding minutes from 1 to 1440.")
        }
        let total = (Unlimited ? reserve: minutes + reserve) * 60
        if policy.Exceeds(total) {
            throw Exception(
                "The time budget exceeds the limit of " +
                    (policy.MaxSeconds > 0 ? Math.Min(policy.MaxSeconds, 86400) / 60: 1440).ToString() + " minutes."
            )
        }
        return total
    }

    /// The reasoning efforts to choose from: those of the selected model in `models`, or all that Tokate
    /// knows when Pi has no models to offer.
    func EffortChoices(models []ModelChoice) []string {
        for model in models {
            if model.Slug == Model {
                return model.Efforts
            }
        }
        return (Harness == "pi" || Harness == "command") && models.Length == 0 ? DonationDraft.Efforts: []string{}
    }

    /// Selects a model. An effort that the new model does not support is cleared.
    func WithModel(model string, models []ModelChoice) DonationDraft {
        let next = this with{Model = model, Profile = ""}
        return Array.IndexOf(next.EffortChoices(models), Effort) < 0 ? next with{Effort = ""}: next
    }

    func ForHarness(id string) DonationDraft -> this with{
        Harness = id,
        Provider = "",
        Model = id == "codex" ? DonationDraft.DefaultModel: "",
        Effort = id == "codex" ? DonationDraft.DefaultEffort: "",
        Profile = "",
    }

    func UsingProfile(profile DonorProfile) DonationDraft -> this with{
        Profile = profile.Name,
        Harness = profile.Harness,
        Provider = profile.Provider,
        Model = profile.Model,
        Effort = profile.Effort,
        Endpoint = profile.Endpoint,
    }

    shared {
        let DefaultModel string = "gpt-6.1-sol"
        let DefaultEffort string = "high"
        let Efforts []string = []string{"off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "absent"}
        let Initial DonationDraft = DonationDraft{
            Harness: "codex",
            Provider: "",
            Model: DefaultModel,
            Effort: DefaultEffort,
            Endpoint: "",
            Profile: "",
            Coding: "30",
            Verification: "30",
        }
    }
}

/// A reserved donation from the request to the result. `Tone` says who must act on `State`, `Polling` that
/// the app checks for approval, and `Truncated` that the output lost its earliest lines.
data struct DonationProgress {
    var Path string
    var Run Run
    var Ready bool
    var Polling bool
    var Started bool
    var Running bool
    var Output IReadOnlyList[OutputLine]
    var OutputRevision int64
    var Truncated bool
    var Elapsed int32
    var State string
    var Tone Tone

    /// The coding and verification limits together in seconds, or zero when coding time is unlimited.
    prop Limit int32 -> Run.Unlimited ? 0: Run.CodingSeconds + Run.VerificationReserve

    shared {
        let Empty DonationProgress = DonationProgress{
            Path: "",
            Run: Run.Empty,
            Output: []OutputLine{},
            State: "",
            Tone: Tone.Wait,
        }

        /// Minutes and seconds, with hours only when there are any.
        func Clock(seconds int32) string -> (seconds >= 3600 ? (seconds / 3600).ToString() + ":": "") + (seconds / 60 % 60).ToString(
            "00"
        ) + ":" + (seconds % 60).ToString("00")

        func ElapsedText(seconds int32) string -> (seconds / 3600).ToString("00") + ":" + (seconds / 60 % 60).ToString(
            "00"
        ) + ":" + (seconds % 60).ToString("00")
    }
}

/// Everything the donate page shows: the chosen project and issue, the donor's selection and limits,
/// and the reserved donation's progress.
data struct DonationState {
    var Step DonationStep
    var Input string
    var Repository string
    var Account string
    var Policy Policy
    var Issue string
    var IssueTitle string
    var Draft DonationDraft
    var Profiles []DonorProfile
    /// The catalog of Codex.
    var Models []ModelChoice
    var OmpModels []ModelChoice
    /// The harnesses that are not set up on this computer.
    var Unready []string
    var Progress DonationProgress
    var RepositoryMode bool
    var PerTask string
    var Total string
    var Prompt string
    var Consent string
    var ReviewedArguments []string
    var Session DonationSession
    var StopRequested bool

    prop Identity string -> RepositoryMode ? Repository: Repository + " #" + Issue

    /// The models to choose from for the selected harness and provider.
    func Catalog() []ModelChoice -> ModelChoice.Catalog(Draft.Harness, Draft.Provider, Models, OmpModels, Policy)

    func Efforts() []string -> Draft.EffortChoices(Catalog())

    /// Clears a model or an effort that the catalog does not offer. A profile keeps its saved choice, and
    /// a catalog that is not loaded changes nothing.
    func Settled() DonationState {
        let harness = Draft.Harness
        if Draft.Profile != "" || (harness == "codex" && Models.Length == 0) || (harness == "omp" && OmpModels.Length == 0) ||
            ((harness == "pi" || harness == "command") && !Policy.RestrictsTool(harness, harness == "command" ? Draft.Provider: HarnessOption.ProviderOf(harness))) {
            return this
        }
        let models = Catalog()
        let model = Draft.Model
        if !Array.Exists(models, choice -> choice.Slug == model) {
            return this with{Draft = Draft with{Model = "", Effort = ""}}
        }
        return Array.IndexOf(Draft.EffortChoices(models), Draft.Effort) < 0 ? this with{Draft = Draft with{Effort = ""}}: this
    }

    shared {
        let Presets []string = []string{"15", "30", "60"}

        let Initial DonationState = DonationState{
            Step: DonationStep.Issue,
            Input: "",
            Repository: "",
            Account: "",
            Policy: Policy.Empty,
            Issue: "",
            IssueTitle: "",
            Draft: DonationDraft.Initial,
            Profiles: []DonorProfile{},
            Models: []ModelChoice{},
            OmpModels: []ModelChoice{},
            Unready: []string{},
            Progress: DonationProgress.Empty,
            PerTask: "60",
            Total: "",
            Prompt: "",
            Consent: "",
            ReviewedArguments: []string{},
        }
    }
}

data struct DonationTask {
    var Issue string
    var Result string
    var Reason string
    var PullRequest string
    var Directory string
}

data struct DonationSession {
    var Repository string
    var Reason string
    var Submitted int32
    var Skipped int32
    var Failed int32
    var Usage string
    var WallSeconds string
    var Tasks []DonationTask
}
