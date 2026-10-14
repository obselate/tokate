package TokateDesktop

import System

func OwnerTests() {
    var changes = 0
    let changed = () -> {
        changes++
    }
    let feedback = FeedbackService(changed)
    let navigation = NavigationService(changed)
    let activity = ActivityService(WindowService(changed), navigation, feedback, changed)
    let owner = OwnerService(
        CommandRunner(activity, feedback, navigation),
        activity,
        feedback,
        DialogService(changed),
        changed
    )

    owner.AddCheck(" build ")
    owner.AddCheck("build")
    Regression.Check(owner.Current.Setup.Checks.Length == 1 && owner.Current.Setup.ChecksChanged, "checks are trimmed and unique")
    owner.RemoveCheck("build")
    Regression.Check(owner.Current.Setup.Checks.Length == 0, "check removed")

    owner.AddCommand("dotnet test")
    Regression.Equal(Regression.Args(owner.Current.Setup.Commands[0]), "/bin/sh -c dotnet test", "commands run through the shell")
    owner.RemoveCommand(0)
    Regression.Check(owner.Current.Setup.Commands.Length == 0 && owner.Current.Setup.CommandsChanged, "command removed")

    owner.AddModel(" gpt ", "high, ,xhigh")
    owner.AddModel("other", "")
    owner.AddModel("gpt", "low")
    let models = owner.Current.Setup.Models
    Regression.Check(
        models.Length == 2 && models[0].Model == "gpt" && Regression.Args(models[0].Efforts) == "low",
        "adding a model again replaces its efforts"
    )
    Regression.Equal(Regression.Args(models[1].Efforts), "absent", "models without efforts are absent")
    Regression.Equal(owner.Current.Setup.ModelPolicy, "whitelist", "editing models selects the whitelist")
    owner.RemoveModel("gpt")
    Regression.Check(owner.Current.Setup.Models.Length == 1, "model removed")
    owner.ToggleTool("pi")
    owner.SetModelTool("pi/local-chat-completions")
    Regression.Check(owner.Current.Setup.Models.Length == 0 && owner.Current.Setup.ModelPolicy == "unrestricted", "new tools allow any model")
    owner.AddModel("local", "")
    owner.SetModelTool("codex/openai")
    Regression.Check(owner.Current.Setup.Models.Length == 1 && owner.Current.Setup.Models[0].Model == "other", "tool model lists stay separate")
    owner.ToggleTool("pi")

    owner.ToggleTool("codex")
    Regression.Equal(owner.Current.Setup.Tools, "codex/openai", "the last tool stays allowed")
    owner.ToggleTool("pi")
    owner.ToggleTool("codex")
    Regression.Equal(owner.Current.Setup.Tools, "pi/local-chat-completions", "tools toggle")
    owner.ToggleTool("omp")
    Regression.Check(owner.Current.OmpOpen && owner.Current.Setup.Tools == "pi/local-chat-completions", "OMP opens its providers")
    owner.ToggleProvider("open router")
    owner.ToggleProvider(" openrouter ")
    owner.ToggleProvider("gufo")
    Regression.Equal(
        owner.Current.Setup.Tools,
        "pi/local-chat-completions,omp/openrouter,omp/gufo",
        "OMP providers are pairs"
    )
    owner.ToggleProvider("gufo")
    owner.ToggleTool("omp")
    Regression.Equal(owner.Current.Setup.Tools, "pi/local-chat-completions", "OMP removes its providers")

    owner.Current = owner.Current with{Written = "files"}
    owner.SetStep(2)
    Regression.Check(owner.Current.Written == "files" && owner.Current.Setup.Step == 2, "changing steps keeps the report")
    owner.SetMinutes("30")
    Regression.Check(owner.Current.Written == "", "editing setup discards the report")
    owner.AddCommandTool("custom", "[\"tool\",\"--model\",\"{model}\",\"{prompt_file}\"]", "session")
    owner.AddModel("custom-model", "high")
    let command = Array.Find(owner.Current.Setup.ToolModels, tool -> tool.Tool == "command/custom")
    Regression.Check(command.Command[2] == "{model}" && command.Output == "session" && command.Models.Length == 1, "model edits preserve command argv and output")
    let encoded = Json.Parse(Json.AllowedTools(owner.Current.Setup.EffectiveTools(), owner.Current.Setup.ToolModels))
    let commandJson = Array.Find(Json.Items(encoded), tool -> Json.Text(tool, "harness") == "command")
    Regression.Check(Json.Strings(commandJson, "command")[3] == "{prompt_file}" && Json.Text(commandJson, "output") == "session", "command harness declaration matches CLI shape")
    owner.Current = owner.Current with{SetupPreviewed = true}
    owner.SetMinutes("31")
    Regression.Check(!owner.Current.SetupPreviewed, "editing setup invalidates the preview")

    owner.SelectTab(OwnerTab.Setup)
    Regression.Check(!owner.Current.Browsing, "setup is not browsing")
    owner.Current = owner.Current with{Open = true, Tab = OwnerTab.Contributions}
    Regression.Check(owner.Current.Browsing, "the open issue list is browsing")
    owner.Current = owner.Current with{Selected = Issue{Number: 3, Title: "t", State: "open", Labels: []string{}, Url: ""}}
    Regression.Check(!owner.Current.Browsing, "an open issue is not browsing")
    owner.Deselect()
    Regression.Check(owner.Current.Selected == nil, "deselect")
    Regression.Check(owner.Current.WorkFor("3") == nil, "no work before inspection")
}
