package TokateDesktop

import Goo

/// Numbered progress through a fixed sequence, announced as "Step n of N: name".
data struct StepIndicator {
    var Names []string
    var Numerals []string
    var Current int32

    func Build() Container {
        let p = AppTheme.Current
        let progress = Row{
            Children: []Blob{},
            Gap: 10,
            Name: "Step " + (Current + 1).ToString() + " of " + Names.Length.ToString() + ": " + Names[Current],
        }.Build()
        for i in 0 ... Names.Length {
            let active = i == Current
            progress.Children.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 8,
                    Padding: Edges{Left: 12, Right: 12, Top: 8, Bottom: 8},
                    BorderRadius: 4,
                    BackgroundColor: active ? p.Surface: Color.Transparent,
                    BorderWidth: Edges{Bottom: active ? 2: 0},
                    BorderColor: p.Accent,
                    Label{Content: Numerals[i], Size: 16, Muted: !active}.Build(),
                    Label{Content: Names[i], Size: 16, Muted: !active}.Build(),
                }
            )
        }
        return progress
    }
}
