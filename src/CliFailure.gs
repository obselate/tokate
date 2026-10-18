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

    shared {
        internal func Message(code string) string -> switch code {
            case "invalid_arguments": "Invalid command arguments. Consult command help."
            case "missing_tools": "Required tools are missing or failed diagnostics. Run doctor."
            case "namespace_disabled": "User namespaces are disabled. Ask an administrator to review the host or container namespace policy."
            case "namespace_restricted": "Namespace startup was denied while AppArmor namespace restrictions are enabled. Ask an administrator to review the relevant AppArmor denials."
            case "namespace_unavailable": "Namespace startup failed. Ask an administrator to review kernel support, namespace limits and host or container security policy."
            case "authentication_required": "Authentication is required with the appropriate account."
            case "stale_approval": "Owner approval is absent or changed. Fresh owner approval is required."
            case "invalid_state": "The saved run or command state does not permit this operation. Inspect its artifacts."
            case "protected_path": "Contribution changes a protected owner path. Restore the path named in the saved error before recovery."
            case "verification_failed": "Independent verification failed. Inspect the private verification artifact."
            case "inference_failed": "Inference did not complete successfully. Inspect private events and report artifacts and read saved status for recovery."
            case "endpoint_unavailable": "Selected local endpoint did not provide valid bounded metadata advertising the exact model ID. No inference started."
            case "output_too_large": "The complete result cannot fit within 64 KiB. Use focused help or private artifacts for details."
            default: "Command failed. Inspect relevant state and private artifacts before any explicit next action."
        }
    }
}
