package Tokate

import System
import System.IO
import System.Text.Json

internal class ExecutionFailure {
    shared {
        internal func Handled(error Exception) bool -> error is CliFailure ||
            error is IOException ||
            error is UnauthorizedAccessException ||
            error is JsonException ||
            error is CommandInterrupted ||
            error.GetType() == typeof(Exception)

        internal func Create(code string, message string) CliFailure ->
        CliFailure(code, message, summary: CliFailure.Message(PublicOutput.FailureCode))

        internal func From(error Exception, code string = "command_failed") CliFailure {
            if error is CliFailure failure {
                return failure
            }

            let failure = CliFailure(code, error.Message, summary: CliFailure.Message(code))
            if let result = Commands.InterruptedResult(error) {
                failure.Data["command_result"] = result
            }
            return failure
        }
    }
}
