package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The donor's saved profiles, each applying its tool, model and effort.
data struct ProfileButtons {
    var Profiles []DonorProfile
    var Button CommandButton
    var OnUse Action[DonorProfile]?

    func Build() Blob {
        let use = OnUse
        let buttons = List[Blob]()
        for profile in Profiles {
            let selected = profile
            buttons.Add((Button with{Label = "Use " + profile.Name, OnClick = () -> use?.Invoke(selected)}).Build())
        }
        return Row{Children: buttons.ToArray()}.Build()
    }
}
