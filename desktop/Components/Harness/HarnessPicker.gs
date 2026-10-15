package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The harness of a donation. A harness that the owner does not allow, or that is not set up on this
/// computer, does not show, unless a saved profile selected it.
data struct HarnessPicker {
    var Selected string
    var Policy Policy
    var AllowCommand bool
    var Unready []string
    var Logo Func[string, Blob]?
    var Disabled bool
    var OnChoose Action[string]?

    func Build() Blob {
        let choose = OnChoose
        let cards = List[Blob]()
        for option in HarnessOption.All {
            if option.Id == "pi" { continue }
            let merged = option.Id == "omp"
            let readyOmp = Policy.AllowsHarness("omp") && Array.IndexOf(Unready ?? []string{}, "omp") < 0
            let readyPi = Policy.AllowsHarness("pi") && Array.IndexOf(Unready ?? []string{}, "pi") < 0
            let id = merged && !readyOmp && readyPi ? "pi": option.Id
            let allowed = merged ? Policy.AllowsHarness("omp") || Policy.AllowsHarness("pi"): id == "command" && AllowCommand || Policy.AllowsHarness(id)
            let selected = merged ? Selected == "omp" || Selected == "pi": Selected == id
            if id == "command" && !allowed { continue }
            if (!allowed || (merged ? !readyOmp && !readyPi: Array.IndexOf(Unready ?? []string{}, id) >= 0)) && !selected { continue }
            let card = ChoiceCard{
                Title: option.Name + (!allowed ? " (not allowed)": ""),
                Detail: "",
                Icon: "terminal",
                Art: id == "command" ? nil: Logo?.Invoke(merged ? "omp": id),
                Compact: true,
                Selected: selected,
                OnChoose: () -> choose?.Invoke(id),
                Disabled: Disabled || !allowed,
            }.Build()
            cards.Add(Container{MinWidth: AppTheme.ChoiceMinWidth, FlexBasis: AppTheme.ChoiceMinWidth, FlexGrow: 1, card})
        }
        if cards.Count == 0 {
            return Callout{Message: "No harness that this repository allows is set up on this computer.", Tone: Tone.Wait}.Build()
        }
        return Row{Children: cards.ToArray()}.Build()
    }
}
