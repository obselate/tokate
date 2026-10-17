package Tokate

import System
import System.Collections.Generic
import System.Text.Json
import System.Text.RegularExpressions

internal class Args {
    internal let Values Dictionary[string, string] = Dictionary[string, string]()
    internal let Words List[string] = List[string]()
    internal var Command string = "help"
    internal var Help bool = false
    internal var Subject string = ""
    internal var Run string = ""
    internal var SavedDefaults JsonElement
    internal var HarnessFromDefault bool

    internal init(args[]string) {
        Parse(this, args)
    }

    shared {
        internal var Parse Action[Args, []string]

        internal func Label(key string) string -> switch key {
            case "issue": "ISSUE"
            case "pr": "PR"
            case "prs": "PR..."
            case "donor": "LOGIN"
            case "run": "RUN"
            case "attempt": "RUN"
            case "repo": "OWNER/REPO"
            case "profile": "NAME"
            case "seconds": "--time"
            case "verification-reserve": "--verify-time"
            case "reservation-seconds": "--reservation-time"
            default: "--" + key
        }
    }

    internal func Get(key string, fallback string = "") string {
        var value string
        return Values.TryGetValue("--" + key, out value) ? value: fallback
    }

    internal func Need(key string) string {
        let value = Get(key)

        if value == "" {
            throw CliFailure("invalid_arguments", "Required: " + Args.Label(key))
        }

        return value
    }

    internal func Number(key string, fallback string = "") int32 {
        let value = Get(key, fallback)
        var number int32

        if (key == "verification-reserve" && !Regex.IsMatch(value, "^[0-9]+\\z")) || !Int32.TryParse(
            value,
            out number
        ) ||
            number < 1 {
            throw Exception("Invalid positive number: " + Args.Label(key))
        }

        if (key == "seconds" || key == "timeout") && number > RuntimeBudget.MaxBudgetSeconds {
            throw Exception("Use at most 24h: " + Args.Label(key == "seconds" && Command == "init" ? "max-time": key))
        }

        return number
    }
}
