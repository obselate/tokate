package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// Repository search and saved choices. Validation and loading belong to the caller.
data struct RepositoryPicker {
    var Input string
    var Recent []string
    var Saved []string
    var Status string
    var Tone Tone
    var Loading bool
    var Disabled bool
    var Invalid bool
    var Button CommandButton
    var OnInput Action[string]?
    var OnChoose Action[string]?
    var OnFind Action?

    func Build() Blob {
        let choose = OnChoose
        let children = List[Blob]{
            InputField{Label: "GitHub repository", Value: Input, Placeholder: "owner/repository or GitHub URL", Width: AppTheme.WideFieldWidth, Disabled: Disabled, OnChange: OnInput}.Build(),
        }
        if Loading {
            children.Add(Label{Content: "Checking repository...", Muted: true}.Build())
        } else if Status != "" {
            children.Add(Callout{Message: Status, Tone: Tone}.Build())
        }
        let seen = HashSet[string](StringComparer.OrdinalIgnoreCase)
        for index in 0 ... 2 {
            let source = index == 0 ? Recent: Saved
            let rows = List[Blob]()
            for repository in source ?? []string{} {
                if seen.Add(repository) && (Input == "" || repository.Contains(Input, StringComparison.OrdinalIgnoreCase)) {
                    let name = repository
                    rows.Add((Button with{Label = repository, Kind = ButtonKind.Quiet, Disabled = Disabled, OnClick = () -> choose?.Invoke(name)}).Build())
                }
            }
            if rows.Count > 0 {
                children.Add(Label{Content: index == 0 ? "Recent": "Saved and yours", Muted: true}.Build())
                children.Add(Row{Children: rows.ToArray()}.Build())
            }
        }
        if Input == "" && seen.Count == 0 {
            children.Add(Label{Content: "Search by repository name or paste a GitHub URL.", Muted: true}.Build())
        }
        var action = Button with{Label = "Choose repository", Primary = true, Disabled = Disabled || Loading || Invalid || String.IsNullOrWhiteSpace(Input), OnClick = OnFind}
        if action.Loading { action.Disabled = false }
        children.Add(Row{Children: []Blob{action.Build()}}.Build())
        return Panel{Name: "Repository picker", Children: children.ToArray()}.Build()
    }
}
