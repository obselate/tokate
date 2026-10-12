package TokateDesktop

import System
import System.Collections.Generic
import System.Text.Json

class CliCodec {
    shared {
        func Envelope(value JsonElement) Envelope {
            let failure = Json.Get(value, "error")
            let actions = List[NextAction]()
            for action in Json.Items(value, "next_actions") {
                actions.Add(NextAction{Arguments: Json.Strings(action)})
            }
            return Envelope{
                SchemaVersion: Json.Int(value, "schema_version"),
                Command: Json.Text(value, "command"),
                Status: Status(Json.Text(value, "status")),
                ExitCode: Json.Int(value, "exit_code"),
                Error: Json.IsObject(failure) ? CliError{
                    Code: Json.Text(failure, "code"),
                    Message: Json.Text(failure, "message")
                }: nil,
                NextActions: actions.ToArray(),
                Truncated: Json.Bool(value, "truncated"),
            }
        }

        func Status(value string) CliStatus -> switch value {
            case "ok": CliStatus.Ok
            case "pending": CliStatus.Pending
            default: CliStatus.Error
        }

        func Matches(envelope Envelope, exitCode int32, command string) bool ->
        envelope.SchemaVersion == 1 && envelope.ExitCode == exitCode && envelope.Command == command

        func Report(value JsonElement) string {
            let failure = Json.Get(value, "error")
            var report = Json.IsObject(failure) ? Json.Raw(failure): Json.Raw(Json.Get(value, "data"))
            if Json.Bool(value, "truncated") {
                report += "\nSome results were omitted by the CLI."
            }
            return report
        }

        func RunPath(value JsonElement) string -> Json.Text(Json.Get(value, "data"), "run")
    }
}
