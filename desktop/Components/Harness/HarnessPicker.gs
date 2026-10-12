package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The harness of a donation. A harness that the owner does not allow, or that is not set up on this
/// computer, does not show, unless a saved profile selected it.
data struct HarnessPicker {
    var Selected string
    var Policy Policy
    var Unready []string
    var Logo Func[string, Blob]?
    var Disabled bool
    var OnChoose Action[string]?

    func Build() Blob {
        let choose = OnChoose
        let cards = List[Blob]()
        for option in HarnessOption.All {
            let id = option.Id
            let allowed = Policy.AllowsHarness(id)
            if (!allowed || Array.IndexOf(Unready ?? []string{}, id) >= 0) && Selected != id {
                continue
            }
            cards.Add(
                ChoiceCard{
                    Title: option.Name,
                    Detail: allowed ? "": "Not allowed",
                    Icon: "terminal",
                    Art: Logo?.Invoke(id),
                    Compact: true,
                    Selected: Selected == id,
                    OnChoose: () -> choose?.Invoke(id),
                    Disabled: Disabled || !allowed,
                }.Build()
            )
        }
        if cards.Count == 0 {
            return Callout{Message: "No harness that this repository allows is set up on this computer.", Tone: Tone.Wait}.Build()
        }
        return Row{Children: cards.ToArray()}.Build()
    }
}
