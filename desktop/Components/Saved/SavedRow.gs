package TokateDesktop

import Goo
import System

/// One saved run with its issue title and status. Opens the run when it has been read.
data struct SavedRow {
    var Item SavedRun
    var Index int32
    var Disabled bool
    var OnOpen Action[SavedRun]?

    func Build() Blob {
        let p = AppTheme.Current
        let item = Item
        let choose = OnOpen
        let identity = Item.Identity(Index)
        let title = Heading{Content: Item.Title == "" ? identity: Item.Title, Size: AppTheme.ItemSize, MaxLines: 2}.Build()
        let copy = Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Gap: 5}
        if Item.Title != "" {
            copy.Children.Add(Label{Content: identity, Size: AppTheme.SmallSize, Muted: true}.Build())
        }
        copy.Children.Add(title)
        return Interaction.Keyboard(
            Button{
                Key: Item.Path,
                MinHeight: 72,
                Padding: 12,
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 18,
                BorderWidth: Edges{Bottom: 1},
                BorderColor: p.Line,
                BackgroundColor: Color.Transparent,
                Hover: Style{BackgroundColor: p.Paper},
                Focus: AppTheme.FocusStyle(),
                Focusable: true,
                Disabled: Disabled || !Item.Openable,
                Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: "Saved " + identity, Description: Item.Error},
                OnClick: () -> choose?.Invoke(item),
                copy,
                StatusBadge{Value: Item.Status(), Tone: Statuses.ToneOf(Item.Status())}.Build(),
            }
        )
    }
}
