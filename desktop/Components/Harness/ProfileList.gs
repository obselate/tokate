package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The saved profiles: the logo of the harness, the name and the model of each, with its actions.
data struct ProfileList {
    var Profiles []DonorProfile
    var Logo Func[string, Blob]?
    var Button CommandButton
    var OnEdit Action[DonorProfile]?
    var OnRemove Action[DonorProfile]?

    func Build() Blob {
        let edit = OnEdit
        let remove = OnRemove
        let rows = List[Blob]()
        for profile in Profiles {
            let item = profile
            if rows.Count > 0 {
                rows.Add(Rule{}.Build())
            }
            let row = List[Blob]()
            if let logo = Logo {
                row.Add(Container{Width: 28, Height: 28, FlexShrink: 0, logo(item.Harness)})
            }
            row.Add(
                Container{
                    FlexGrow: 1,
                    FlexBasis: 0,
                    MinWidth: 200,
                    Gap: 2,
                    Heading{Content: item.Name, Size: AppTheme.ItemSize}.Build(),
                    Label{Content: Summary(item), Size: AppTheme.SmallSize, Muted: true}.Build(),
                }
            )
            row.Add((Button with{Label = "Change", Name = "Change profile " + item.Name, OnClick = () -> edit?.Invoke(item)}).Build())
            row.Add(
                (Button with{
                    Label = "Remove",
                    Name = "Remove profile " + item.Name,
                    Kind = ButtonKind.Quiet,
                    OnClick = () -> remove?.Invoke(item),
                }).Build()
            )
            rows.Add(ListRow{Children: row.ToArray()}.Build())
        }
        let panel = Panel{Children: rows.ToArray(), Name: "Saved profiles"}.Build()
        panel.Padding = 8
        panel.Gap = 0
        return panel
    }

    private func Summary(profile DonorProfile) string {
        var text = HarnessOption.NameOf(profile.Harness)
        if profile.Harness == "omp" && profile.Provider != "" {
            text += " \u00b7 " + profile.Provider
        }
        text += " \u00b7 " + profile.Model
        return profile.Effort != "" ? text + " / " + ModelChoice.EffortLabel(profile.Effort): text
    }
}
