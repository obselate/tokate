package Tokate

import System

internal class ExecutionFailure {
    shared {
        internal func Create(code string, message string) CliFailure ->
        CliFailure(code, message, summary: PublicOutput.Message(PublicOutput.FailureCode))

        internal func From(error Exception, code string = "command_failed") CliFailure {
            if error is CliFailure failure {
                return failure
            }

            let failure = CliFailure(code, error.Message, summary: PublicOutput.Message(code))
            if let result = Commands.InterruptedResult(error) {
                failure.Data["command_result"] = result
            }
            return failure
        }
    }
}
