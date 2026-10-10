package TokateDesktop

import System

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

    shared {
        let All []HarnessOption = []HarnessOption{
            HarnessOption{Id: "codex", Name: "Codex"},
            HarnessOption{Id: "pi", Name: "Pi / local"},
        }
    }
}

data struct DonorProfile {
    var Name string
    var Harness string
    var Model string
    var Effort string
    var Endpoint string
}

data struct CodexModel {
    var Slug string
    var DisplayName string
    var Efforts []string
    var Hidden bool

    shared {
        func EffortLabel(value string) string -> value == "xhigh" ? "Extra high": value == "" ? "": char.ToUpperInvariant(
            value[0]
        ).ToString() + value.Substring(1)
    }
}

data struct DonationDraft {
    var Harness string
    var Model string
    var Effort string
    var Endpoint string
    var Profile string
    var Coding string
    var Unlimited bool
    var Verification string
    var Network bool

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

    func ForHarness(id string) DonationDraft -> this with{
        Harness = id,
        Model = id == "codex" ? DonationDraft.DefaultModel: "",
        Effort = id == "codex" ? DonationDraft.DefaultEffort: "",
        Profile = "",
    }

    func UsingProfile(profile DonorProfile) DonationDraft -> this with{
        Profile = profile.Name,
        Harness = profile.Harness,
        Model = profile.Model,
        Effort = profile.Effort,
        Endpoint = profile.Endpoint,
    }

    shared {
        let DefaultModel string = "gpt-6.1-sol"
        let DefaultEffort string = "high"
        let Initial DonationDraft = DonationDraft{
            Harness: "codex",
            Model: DefaultModel,
            Effort: DefaultEffort,
            Endpoint: "",
            Profile: "",
            Coding: "30",
            Verification: "30",
        }
    }
}

data struct DonationProgress {
    var Path string
    var Run Run
    var Ready bool
    var Started bool
    var Running bool
    var Output string
    var Elapsed int32
    var State string

    shared {
        let Empty DonationProgress = DonationProgress{Path: "", Run: Run.Empty, Output: "", State: ""}

        func ElapsedText(seconds int32) string -> (seconds / 3600).ToString("00") + ":" + (seconds / 60 % 60).ToString(
            "00"
        ) + ":" + (seconds % 60).ToString("00")
    }
}
