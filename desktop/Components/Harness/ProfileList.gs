package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The saved profiles: the logo of the harness, the name and the model of each, with its actions. The
/// default profile has a badge.
data struct ProfileList {
    var Profiles []DonorProfile
    var Logo Func[string, Blob]?
    var Button CommandButton
    var OnDefault Action[DonorProfile]?
    var OnClearDefault Action?
    var OnEdit Action[DonorProfile]?
    var OnRemove Action[DonorProfile]?

    func Build() Blob {
        let edit = OnEdit
        let choose = OnDefault
        let remove = OnRemove
        let rows = List[Blob]()
        for profile in Profiles {
            let item = profile
            let row = List[Blob]()
            if let logo = Logo {
                if item.Harness != "command" {
                    row.Add(Container{Width: 28, Height: 28, FlexShrink: 0, logo(item.Harness)})
                }
            }
            row.Add(
                Container{
                    FlexGrow: 1,
                    FlexBasis: 0,
                    MinWidth: AppTheme.ColumnMin,
                    Gap: AppTheme.Space4,
                    Row{Gap: AppTheme.Space8, Children: item.Default ? []Blob{Heading{Content: item.Name, Size: AppTheme.ItemSize}.Build(), StatusChip{Value: "Default", Tone: Tone.Done}.Build()}: []Blob{Heading{Content: item.Name, Size: AppTheme.ItemSize}.Build()}}.Build(),
                    Label{Content: Summary(item), Size: AppTheme.SmallSize, Muted: true}.Build(),
                }
            )
            let actions = List[Blob]()
            if item.Default {
                actions.Add((Button with{Label = "Clear default", OnClick = OnClearDefault}).Build())
            } else {
                actions.Add(
                    (Button with{
                        Label = "Set as default",
                        Name = "Set " + item.Name + " as default",
                        OnClick = () -> choose?.Invoke(item),
                    }).Build()
                )
            }
            actions.Add((Button with{Label = "Change", Name = "Change profile " + item.Name, OnClick = () -> edit?.Invoke(item)}).Build())
            actions.Add(
                (Button with{
                    Label = "Remove",
                    Name = "Remove profile " + item.Name,
                    Tone = ButtonTone.Danger,
                    OnClick = () -> remove?.Invoke(item),
                }).Build()
            )
            row.Add(Row{NoWrap: true, Children: actions.ToArray()}.Build())
            rows.Add(ListRow{Children: row.ToArray()}.Build())
        }
        return ListSection{Title: "Saved profiles", Count: Profiles.Length, Children: rows.ToArray()}.Build()
    }

    private func Summary(profile DonorProfile) string -> ModelChoice.Tool(profile.Harness, profile.Provider) + " \u00b7 " + ModelChoice.Pair(
        profile.Model,
        profile.Effort
    )
}
