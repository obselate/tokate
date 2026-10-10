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
    var Compact bool

    func Build() Blob -> Panel{
        Compact: Compact,
        Children: []Blob{
            Stack{
                Gap: 16,
                Children: []Blob{
                    Heading{Content: "#" + Issue + "  " + Title, Size: 27}.Build(),
                    Label{Content: Repository, Size: 17, Muted: true}.Build(),
                    Rule{}.Build(),
                    Row{
                        Children: []Blob{
                            SummaryTile{
                                Title: "Coding time",
                                Value: Draft.Unlimited ? "Unlimited": Draft.Coding + " minutes",
                                Icon: "schedule",
                            }.Build(),
                            SummaryTile{Title: "Verification", Value: Draft.Verification + " minutes", Icon: "verified"}.Build(),
                        },
                    }.Build(),
                    DetailRow{Caption: "Account", Value: Account}.Build(),
                    DetailRow{Caption: "Coding tool", Value: Draft.Harness}.Build(),
                    DetailRow{Caption: "Model", Value: Draft.Model + " / " + Draft.Effort}.Build(),
                    DetailRow{Caption: "Project network", Value: Draft.Network ? "Allowed": "Offline"}.Build(),
                },
            }.Build(),
        },
    }.Build()
}
