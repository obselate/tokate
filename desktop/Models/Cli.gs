package TokateDesktop

import System

enum CliStatus {
    Ok,
    Pending,
    Error
}

data struct CliError {
    var Code string
    var Message string
    prop Recovery string -> switch Code {
        case "stale_approval": "Keep the saved work. Ask the owner to review current authority and re-approve the issue."
        case "authentication_required": "Use the original donor account. Inspect saved status before continuing."
        case "inference_failed": "Preserve partial work. Inspect status before fresh preparation with a new explicit budget."
        case "verification_failed": "Inspect saved verification results. Correct the exact commit before recovery or amendment."
        case "invalid_state": "Inspect saved state and artifacts. Do not overwrite evidence or start another attempt to bypass this refusal."
        case "invalid_arguments": "Read command help and correct the arguments before continuing."
        case "missing_tools": "Repair the selected installation, then run doctor. No inference has started."
        case "endpoint_unavailable": "Check the local endpoint and exact model before fresh preparation."
        default: "Inspect saved and remote state before repeating this command. No automatic retry is made."
    }
}

data struct NextAction {
    var Arguments []string

    prop Command string -> Arguments.Length > 1 ? Arguments[1]: ""
}

data struct Envelope {
    var SchemaVersion int32
    var Command string
    var Status CliStatus
    var ExitCode int32
    var Error CliError?
    var NextActions []NextAction
    var Truncated bool
}

data struct CommandOutcome {
    var Envelope Envelope?
    var ExitCode int32
    var Diagnostics string
    var Failure string
    var Report string
    var RunPath string

    prop Succeeded bool -> Failure == "" && ExitCode == 0

    prop Pending bool -> Envelope?.Status == CliStatus.Pending
    prop Warning string -> String.Join("\n", Array.FindAll(Diagnostics.Split('\n'), line -> line.StartsWith("Warning:", StringComparison.Ordinal)))

    func ErrorMessage() string {
        let message = Envelope?.Error?.Message ?? ""
        if message != "" {
            let code = Envelope?.Error?.Code ?? ""
            return code == "" ? message: code + ": " + message + "\n" + Envelope!!.Error!!.Recovery
        }
        let first = Diagnostics.Trim().Split('\n')[0]
        return first != "" ? first: "Could not complete this action."
    }
}

/// A command outcome with the value decoded from its result. `Value` is the type's default when the
/// command failed before decoding.
data struct Reply[T] {
    var Outcome CommandOutcome
    var Value T
}
