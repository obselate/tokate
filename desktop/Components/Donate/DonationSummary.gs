package TokateDesktop

import Goo
import System

data struct DonationSummary {
    var Repository string
    var Issue string
    var Title string
    var Account string
    var Draft DonationDraft
    var Models []ModelChoice

    private func ModelName() string {
        for model in Models ?? []ModelChoice{} {
            if model.Slug == Draft.Model { return model.DisplayName }
        }
        return Draft.Model
    }

    func Build() Blob -> Panel{Name: "Reservation consent", Children: []Blob{
        IconHeading{Icon: "volunteer_activism", Content: "Reserve contribution"}.Build(),
        Stack{Gap: AppTheme.Space12, Children: []Blob{
            Heading{Content: "Repository and scope", Size: AppTheme.ItemSize}.Build(),
            DetailRow{Caption: "Repository", Value: Repository}.Build(),
            DetailRow{Caption: "Issue", Value: "#" + Issue + " · " + Title}.Build(),
            DetailRow{Caption: "Account", Value: Account}.Build(),
        }}.Build(),
        Rule{}.Build(),
        Stack{Gap: AppTheme.Space12, Children: []Blob{
            Heading{Content: "Runner", Size: AppTheme.ItemSize}.Build(),
            DetailRow{Caption: "Harness", Value: ModelChoice.Tool(Draft.Harness, Draft.Provider)}.Build(),
            DetailRow{Caption: "Model", Value: ModelChoice.Pair(ModelName(), Draft.Effort)}.Build(),
        }}.Build(),
        Rule{}.Build(),
        Stack{Gap: AppTheme.Space12, Children: []Blob{
            Heading{Content: "Time", Size: AppTheme.ItemSize}.Build(),
            DetailRow{Caption: "Per task", Value: Draft.Unlimited ? "Until stopped": DurationText.Format(int32.Parse(Draft.Coding) + Draft.ReserveMinutes())}.Build(),
            DetailRow{Caption: "Verification share", Value: DurationText.Format(Draft.ReserveMinutes())}.Build(),
        }}.Build(),
        Label{Content: "This posts a reservation request. No inference starts until you start the donation after owner approval.", Muted: true}.Build(),
    }}.Build()
}
