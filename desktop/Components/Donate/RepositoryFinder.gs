package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// Finds a repository's approved issues from its name or an issue URL.
data struct RepositoryFinder {
    var Input string
    var Account string
    var Button CommandButton
    var Disabled bool
    var RepositoryMode bool
    var OnInput Action[string]?
    var OnFind Action?

    func Build() Blob {
        let children = List[Blob]{
            InputField{
                Label: "GitHub repository or issue URL",
                Value: Input,
                OnChange: OnInput,
                Placeholder: "owner/repository",
                Width: AppTheme.WideFieldWidth,
                Disabled: Disabled,
            }.Build(),
            Row{
                Children: []Blob{
                    (Button with{
                        Label = RepositoryMode ? "Choose repository": "Find approved issues",
                        OnClick = OnFind,
                        Primary = true,
                        Disabled = String.IsNullOrWhiteSpace(Input),
                    }).Build(),
                },
            }.Build(),
        }
        if Account != "" {
            children.Add(DetailRow{Caption: "Account", Value: Account}.Build())
        }
        return Panel{Children: children.ToArray()}.Build()
    }
}
