package TokateDesktop

import Goo
import System

/// The reviewed issue, budget and selection before a reservation is requested.
data struct DonationSummary {
    var Repository string
    var Issue string
    var Title string
    var Account string
    var Draft DonationDraft
    /// The models of the selected harness, for the name of the model.
    var Models []ModelChoice

    private func ModelName() string {
        for model in Models ?? []ModelChoice{} {
            if model.Slug == Draft.Model {
                return model.DisplayName
            }
        }
        return Draft.Model
    }

    func Build() Blob -> Panel{
        Children: []Blob{
            Stack{
                Gap: AppTheme.Space16,
                Children: []Blob{
                    Heading{Content: "#" + Issue + "  " + Title}.Build(),
                    Label{Content: Repository, Size: AppTheme.SmallSize, Muted: true}.Build(),
                    Rule{}.Build(),
                    Row{
                        Children: []Blob{
                            StatTile{
                                Title: "Per task",
                                Value: Draft.Unlimited ? "Unlimited coding": DurationText.Format(int32.Parse(Draft.Coding) + Draft.ReserveMinutes()),
                                Icon: "schedule",
                            }.Build(),
                            StatTile{Title: "Verification share", Value: DurationText.Format(Draft.ReserveMinutes()), Icon: "verified"}.Build(),
                        },
                    }.Build(),
                    DetailRow{Caption: "Account", Value: Account}.Build(),
                    DetailRow{Caption: "Harness", Value: ModelChoice.Tool(Draft.Harness, Draft.Provider)}.Build(),
                    DetailRow{Caption: "Model", Value: ModelChoice.Pair(ModelName(), Draft.Effort)}.Build(),
                },
            }.Build(),
        },
    }.Build()
}
