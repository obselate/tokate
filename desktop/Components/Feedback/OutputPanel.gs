package TokateDesktop

import Goo
import System

/// Output with baseline-aligned metadata and an optional per-item disclosure.
data struct OutputPanel {
    var Title string
    var LineCount int32
    var Elapsed string
    var Collapsible bool
    var Expanded bool
    var OnToggle Action?
    var Children []Blob

    func Header() Blob {
        let header = Row{Align: AlignItems.Baseline, Children: []Blob{
            Heading{Content: Title, Size: AppTheme.ItemSize}.Build(),
        }}.Build()
        if LineCount >= 0 {
            header.Children.Add(Label{Content: LineCount.ToString() + (LineCount == 1 ? " line": " lines"), Size: AppTheme.SmallSize, Muted: true}.Build())
        }
        header.MinHeight = AppTheme.ButtonHeight
        header.Padding = Edges{Left: AppTheme.Space24, Right: AppTheme.Space12, Top: AppTheme.Space8, Bottom: AppTheme.Space8}
        if (Elapsed ?? "") != "" {
            header.Children.Add(Label{Content: "Elapsed " + Elapsed, Size: AppTheme.SmallSize, Muted: true}.Build())
        }
        if Collapsible {
            header.Children.Add(Spacer{}.Build())
            header.Children.Add(CommandButton{Label: (Expanded ? "Collapse ": "Expand ") + Title, Kind: ButtonKind.Icon, Icon: Expanded ? "expand_less": "expand_more", OnClick: OnToggle}.Build())
        }
        return header
    }

    func Build() Blob {
        let panel = Container{
            FlexShrink: 0,
            Overflow: Overflow.Hidden,
            BackgroundColor: AppTheme.Current.Surface,
            BorderWidth: 1,
            BorderColor: AppTheme.Current.Line,
            BorderRadius: AppTheme.PanelRadius,
            Header(),
        }
        if !Collapsible || Expanded {
            panel.Children.Add(Rule{}.Build())
            for child in Children ?? []Blob{} {
                panel.Children.Add(child)
            }
        }
        return panel
    }
}
