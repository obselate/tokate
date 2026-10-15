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
            Gap: AppTheme.Space12,
            Name: "Step " + (Current + 1).ToString() + " of " + Names.Length.ToString() + ": " + Names[Current],
        }.Build()
        for i in 0 ... Names.Length {
            let active = i == Current
            progress.Children.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: AppTheme.Space8,
                    Padding: Edges{Left: AppTheme.Space12, Right: AppTheme.Space12, Top: AppTheme.Space8, Bottom: AppTheme.Space8},
                    BorderRadius: AppTheme.ControlRadius,
                    BackgroundColor: active ? p.Surface: Color.Transparent,
                    BorderWidth: Edges{Bottom: active ? 2: 0},
                    BorderColor: p.Accent,
                    Label{Content: Numerals[i], Size: AppTheme.SmallSize, Muted: !active}.Build(),
                    Label{Content: Names[i], Size: AppTheme.SmallSize, Muted: !active}.Build(),
                }
            )
        }
        return progress
    }
}
