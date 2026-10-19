package TokateDesktop

import Goo
import Goo.Widgets.Inputs
import System
import System.Collections.Generic

/// Applies a saved profile to the donation, with a link to the page that changes the profiles.
data struct ProfilePicker {
    var Profiles []DonorProfile
    var Selected string
    var Button CommandButton
    var Disabled bool
    var OnUse Action[DonorProfile]?
    var OnManage Action?
    var Popup PopupInput

    func Build() Blob {
        let use = OnUse
        let profiles = Profiles
        let options = List[ComboBoxOption]()
        for profile in profiles {
            options.Add(ComboBoxOption{Id: profile.Name, Label: profile.Name, Content: Label{Content: profile.Name}.Build()})
        }
        let children = List[Blob]()
        if profiles.Length > 0 {
            children.Add(
                Dropdown{
                    Caption: "Saved profile",
                    Value: Selected,
                    Placeholder: "None",
                    Options: options.ToArray(),
                    OnChange: name -> {
                        for profile in profiles {
                            if profile.Name == name {
                                use?.Invoke(profile)
                            }
                        }
                    },
                    Width: AppTheme.ShortFieldWidth,
                    Disabled: Disabled,
                    Popup: Popup,
                }.Build()
            )
        }
        children.Add(
            (Button with{
                Label = profiles.Length > 0 ? "Manage profiles": "Save a profile",
                Primary = false,
                AllowWhileBusy = true,
                OnClick = OnManage,
            }).Build()
        )
        return Row{Align: AlignItems.FlexEnd, Children: children.ToArray()}.Build()
    }
}
