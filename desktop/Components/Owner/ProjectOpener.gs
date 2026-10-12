package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// Opens a project: one of the user's repositories, or a repository entered by name.
data struct ProjectOpener {
    var Input string
    var Projects []ProjectChoice
    var Loaded bool
    var Button CommandButton
    var Disabled bool
    var Loader Func[string, Blob]?
    var OnInput Action[string]?
    var OnOpen Action?
    var OnChoose Action[string]?

    func Build() Blob {
        let lines = List[Blob]()
        for project in Projects {
            lines.Add(ProjectRow{Project: project, Disabled: Disabled, OnChoose: OnChoose}.Build())
        }
        if Loaded && Projects.Length == 0 {
            lines.Add(EmptyMessage{Content: "No repositories found", Icon: "folder_off"}.Build())
        } else if !Loaded && Disabled && Loader != nil {
            lines.Add(Loader!!("Reading your repositories"))
        }
        return SectionPanel{
            Title: "Your repositories",
            Count: Projects.Length,
            Trailing: []Blob{
                InputField{
                    Label: "GitHub repository",
                    Bare: true,
                    Value: Input,
                    OnChange: OnInput,
                    Placeholder: "owner/repository",
                    Width: 280,
                    Disabled: Disabled,
                }.Build(),
                (Button with{Label = "Open project", OnClick = OnOpen, Disabled = Input == ""}).Build(),
            },
            Children: lines.ToArray(),
        }.Build()
    }
}
