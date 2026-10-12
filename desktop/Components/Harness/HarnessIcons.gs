package TokateDesktop

class HarnessIcons {
    shared {
        func For(id string) string -> switch id {
            case "pi": "memory"
            case "claude": "auto_awesome"
            case "omp": "hub"
            default: "terminal"
        }
    }
}
