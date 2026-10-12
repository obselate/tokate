package Tokate

import System

internal class CliFailure : Exception {
    internal let Code string
    internal let Action[]string
    internal let Summary string
    internal let AttemptInvalidated bool
    internal let HttpStatus int32
    internal init(
        code string,
        message string,
        action[]string = nil,
        summary string = "",
        attemptInvalidated bool = false,
        httpStatus int32 = 0
    ) : base(message) {
        Code = code
        Action = action ?? []string{}
        Summary = summary == "" ? message: summary
        AttemptInvalidated = attemptInvalidated
        HttpStatus = httpStatus
    }
}
