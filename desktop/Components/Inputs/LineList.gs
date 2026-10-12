package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// Short lines that the user edits in place, removes or adds, up to `Limit`. `Name` names each line, such
/// as "Change 2". `Problem` gives the reason that a line is not accepted, which shows below the line.
data struct LineList {
    var Caption string
    var Name string
    var Lines []string
    var Limit int32
    var Placeholder string
    var Button CommandButton
    var Disabled bool
    var Problem Func[string, string]?
    var OnChange Action[[]string]?

    func Build() Blob {
        let change = OnChange
        let lines = Lines
        let children = List[Blob]{Label{Content: Caption, Size: AppTheme.SmallSize, Muted: true}.Build()}
        for i in 0 ... lines.Length {
            let index = i
            let title = Name + " " + (i + 1).ToString()
            let line = List[Blob]{
                Row{
                    NoWrap: true,
                    Gap: 4,
                    Children: []Blob{
                        Container{
                            FlexGrow: 1,
                            FlexBasis: 0,
                            MinWidth: 0,
                            InputField{
                                Label: title,
                                Bare: true,
                                Value: lines[i],
                                OnChange: value -> {
                                    let next = List[string](lines)
                                    next[index] = value
                                    change?.Invoke(next.ToArray())
                                },
                                Placeholder: Placeholder,
                                Width: 2000,
                                Disabled: Disabled,
                            }.Build(),
                        },
                        (Button with{
                            Label = "Remove",
                            Name = "Remove " + title,
                            Kind = ButtonKind.Icon,
                            Icon = "close",
                            OnClick = () -> {
                                let next = List[string](lines)
                                next.RemoveAt(index)
                                change?.Invoke(next.ToArray())
                            },
                        }).Build(),
                    },
                }.Build(),
            }
            let problem = Problem?.Invoke(lines[i]) ?? ""
            if problem != "" {
                line.Add(Label{Content: problem, Size: AppTheme.SmallSize, Ink: AppTheme.Current.Fail}.Build())
            }
            children.Add(Stack{Gap: 4, Children: line.ToArray()}.Build())
        }
        children.Add(
            Row{
                Children: []Blob{
                    (Button with{
                        Label = "Add " + Name.ToLowerInvariant(),
                        Kind = ButtonKind.Quiet,
                        Icon = "add",
                        IconFirst = true,
                        OnClick = () -> {
                            let next = List[string](lines)
                            next.Add("")
                            change?.Invoke(next.ToArray())
                        },
                        Disabled = lines.Length >= Limit,
                    }).Build(),
                },
            }.Build()
        )
        return Stack{Gap: 8, Children: children.ToArray()}.Build()
    }
}
