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

    func ErrorMessage() string {
        let message = Envelope?.Error?.Message ?? ""
        if message != "" {
            return message
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
