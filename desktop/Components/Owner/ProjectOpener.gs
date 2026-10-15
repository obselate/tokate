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
            if Input == "" || project.Repository.Contains(Input, StringComparison.OrdinalIgnoreCase) {
                lines.Add(ProjectRow{Project: project, Disabled: Disabled, OnChoose: OnChoose}.Build())
            }
        }
        if Loaded && Projects.Length > 0 && lines.Count == 0 {
            lines.Add(EmptyMessage{Content: "No matching repositories", Icon: "search"}.Build())
        }
        if Loaded && Projects.Length == 0 {
            lines.Add(EmptyMessage{Content: "No repositories found", Icon: "folder_off"}.Build())
        } else if !Loaded && Disabled && Loader != nil {
            lines.Add(Loader!!("Reading your repositories"))
        }
        var status = ""
        var tone = Tone.Done
        if !String.IsNullOrWhiteSpace(Input) {
            try {
                status = "Ready to open " + RepositoryRef.Parse(Input).FullName
            } catch (error Exception) {
                status = error.Message
                tone = Tone.Fail
            }
        }
        return Stack{
            Gap: AppTheme.SectionGap,
            Children: []Blob{
                RepositoryPicker{
                    Input: Input, Status: status, Tone: tone, Button: Button,
                    Disabled: Disabled, OnInput: OnInput, OnChoose: OnChoose, OnFind: OnOpen,
                }.Build(),
                ListSection{
                    Title: "Your repositories", Count: Projects.Length,
                    Children: lines.ToArray(),
                }.Build(),
            },
        }.Build()
    }
}
