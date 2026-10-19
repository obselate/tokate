package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The settings of a selected saved run, its pull request and its run directory. `Stacked` uses one column.
data struct RunFacts {
    var Item SavedRun
    var Stacked bool

    func Build() Blob {
        let run = Item.Run ?? Run.Empty
        let facts = List[Blob]()
        if run.Harness != "" {
            facts.Add(DetailRow{Caption: "Harness", Value: ModelChoice.Tool(run.Harness, run.Provider)}.Build())
        }
        if run.Model != "" {
            facts.Add(DetailRow{Caption: "Model", Value: ModelChoice.Pair(run.Model, run.Effort)}.Build())
        }
        if run.Unlimited || run.CodingSeconds > 0 {
            facts.Add(DetailRow{Caption: "Coding limit", Value: run.CodingTime}.Build())
        }
        if run.VerificationReserve > 0 {
            facts.Add(DetailRow{Caption: "Verification limit", Value: run.VerificationTime}.Build())
        }
        facts.Add(
            DetailRow{
                Caption: "Pull request",
                Value: run.Pr == 0 ? "Not submitted": "#" + run.Pr.ToString() + (
                    Item.PullRequest != nil ? "  ·  " + Item.PullRequest!!.Review: ""
                ),
            }.Build()
        )
        let checks = Item.PullRequest?.ChecksSummary ?? ""
        if checks != "" {
            facts.Add(DetailRow{Caption: "Checks", Value: checks}.Build())
        }
        let half = (facts.Count + 1) / 2
        return Panel{
            Children: []Blob{
                Heading{Content: "Run details", Size: AppTheme.ItemSize}.Build(),
                Columns{
                    Stacked: Stacked,
                    Gap: Stacked ? AppTheme.Space12: AppTheme.Space24,
                    Children: []Blob{
                        Stack{Gap: AppTheme.Space12, Children: facts.GetRange(0, half).ToArray()}.Build(),
                        Stack{Gap: AppTheme.Space12, Children: facts.GetRange(half, facts.Count - half).ToArray()}.Build(),
                    },
                }.Build(),
                DetailRow{Caption: "Run directory", Value: Item.Path, Mono: true}.Build(),
            },
        }.Build()
    }
}
