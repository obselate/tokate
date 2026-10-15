package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System
import System.Collections.Generic

/// One saved run: its issue title and status above its repository, pull request, model and age. A run that
/// cannot be read shows the reason. Opens the run when it has been read.
data struct SavedRow {
    var Item SavedRun
    var Index int32
    var Disabled bool
    /// The last row has no line below it.
    var Last bool
    /// A narrow row shows the status below the text.
    var Narrow bool
    var OnOpen Action[SavedRun]?

    func Build() Blob {
        let p = AppTheme.Current
        let item = Item
        let choose = OnOpen
        let identity = Item.Identity(Index)
        let facts = List[string]()
        if Item.Error != "" {
            facts.Add(Item.Error)
        } else if let run = Item.Run {
            if Item.Title != "" {
                facts.Add(identity)
            }
            if run.Pr > 0 {
                facts.Add("PR #" + run.Pr.ToString())
            }
            if run.Model != "" {
                facts.Add(ModelChoice.Pair(run.Model, run.Effort))
            }
        }
        let age = Item.Age(DateTime.UtcNow)
        if age != "" {
            facts.Add(age)
        }
        let copy = Container{
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            Gap: AppTheme.Space4,
            Heading{Content: Item.Title == "" ? identity: Item.Title, Size: AppTheme.ItemSize, MaxLines: 2}.Build(),
        }
        if facts.Count > 0 {
            let summary = Label{
                Content: String.Join("  ·  ", facts),
                Size: AppTheme.SmallSize,
                Muted: true,
                Ink: Item.Error != "" ? p.Fail: nil,
                MaxLines: 1,
            }.Build()
            copy.Children.Add(summary)
        }
        let badge = StatusBadge{Value: Item.Status(), Tone: Statuses.ToneOf(Item.Status())}.Build()
        if Narrow {
            copy.Children.Add(Container{AlignItems: AlignItems.FlexStart, Padding: Edges{Top: AppTheme.Space4}, badge})
        }
        return Interaction.Keyboard(
            Button{
                Key: Item.Path,
                MinHeight: AppTheme.RowHeight,
                Padding: Edges{Left: AppTheme.Space16, Right: AppTheme.Space16, Top: AppTheme.Space12, Bottom: AppTheme.Space12},
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: AppTheme.Space12,
                BorderWidth: Edges{Bottom: Last ? 0: 1},
                BorderColor: p.Line,
                BackgroundColor: Color.Transparent,
                Hover: Style{BackgroundColor: p.Paper},
                Focus: AppTheme.FocusStyle(),
                Focusable: true,
                Disabled: Disabled || !Item.Openable,
                Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: "Saved " + identity, Description: Item.Error},
                OnClick: () -> choose?.Invoke(item),
                copy,
                Narrow ? Container{}: badge,
                MaterialIcons.Create("chevron_right", 20, Item.Openable ? p.Muted: Color.Transparent),
            }
        )
    }
}
