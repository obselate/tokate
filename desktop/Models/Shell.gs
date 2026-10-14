package TokateDesktop

import System

enum Destination {
    Welcome,
    Donate,
    Project,
    Saved,
    Profiles,
    Appearance
}

class Destinations {
    shared {
        let All []Destination = []Destination{
            Destination.Welcome,
            Destination.Donate,
            Destination.Project,
            Destination.Saved,
            Destination.Profiles,
            Destination.Appearance,
        }

        func Label(value Destination) string -> switch value {
            case Destination.Donate: "Donate"
            case Destination.Project: "My project"
            case Destination.Saved: "Saved work"
            case Destination.Profiles: "Profiles"
            case Destination.Appearance: "Appearance"
            default: "Welcome"
        }

        func Caption(value Destination) string -> switch value {
            case Destination.Project: "Project"
            case Destination.Saved: "Saved"
            case Destination.Appearance: "Theme"
            default: Label(value)
        }

        func Parse(label string) Destination {
            for value in All {
                if Label(value) == label {
                    return value
                }
            }
            return Destination.Welcome
        }
    }
}

data struct Activity {
    var Busy bool
    var Title string
    var ActionName string
    var Elapsed int32
    var Stopping bool
    var Visible bool
    var Streaming bool
    var Page Destination

    shared {
        let Idle Activity = Activity{Title: "", ActionName: "", Page: Destination.Welcome}

        func TitleFor(command string) string -> switch command {
            case "claim": "Reserving donation"
            case "work": "Donation running"
            case "prepare": "Preparing donation"
            case "select": "Checking model selection"
            case "status": "Loading saved work"
            case "init": "Preparing project setup"
            case "doctor": "Checking prerequisites"
            case "defaults": "Loading profiles"
            case "models": "Loading models"
            case "debug": "Loading models"
            case "amend": "Amending contribution"
            case "submit": "Submitting contribution"
            case "publish": "Publishing draft PR"
            case "checks": "Checking pull request"
            default: "Loading contribution details"
        }
    }
}

data struct Feedback {
    var Message string
    var Report string
    var Tone Tone
}

data struct ConfirmationTile {
    var Title string
    var Value string
    var Icon string
}

data struct ConfirmationDetail {
    var Label string
    var Value string
}

data struct Confirmation {
    var Title string
    var Text string
    var ConfirmLabel string
    var Heading string
    var Tiles []ConfirmationTile
    var Details []ConfirmationDetail

    prop HasSummary bool -> Heading != "" || Tiles.Length > 0 || Details.Length > 0
}

data struct LayoutMetrics {
    var WindowWidth float64
    var WindowHeight float64
    var ContentWidth float64

    prop Short bool -> WindowHeight < 600

    prop Compact bool -> WindowWidth < 900 || Short

    prop Narrow bool -> WindowWidth < 1120

    shared {
        let Initial LayoutMetrics = LayoutMetrics{WindowWidth: 1280, WindowHeight: 860, ContentWidth: 998}
    }
}

data struct ThemeSettings {
    var Night bool
    var OilPaint bool
    var Motion bool

    shared {
        let Initial ThemeSettings = ThemeSettings{OilPaint: true, Motion: true}
    }
}
