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
    Regression.Equal(owner.Current.Setup.ModelsJson, "{\"gpt\":[\"low\"],\"other\":[\"absent\"]}", "model whitelist JSON")
    Regression.Equal(owner.Current.Setup.ModelPolicy, "whitelist", "editing models selects the whitelist")
    owner.RemoveModel("gpt")
    Regression.Check(owner.Current.Setup.Models.Length == 1, "model removed")

    owner.ToggleTool("codex")
    Regression.Equal(owner.Current.Setup.Tools, "codex", "the last tool stays allowed")
    owner.ToggleTool("pi")
    owner.ToggleTool("codex")
    Regression.Equal(owner.Current.Setup.Tools, "pi", "tools toggle")

    owner.SetNetwork(true)
    Regression.Check(owner.Current.Setup.EffectiveNetwork(Policy.Empty), "network allowed")

    owner.Current = owner.Current with{Preview = SetupPreview{Arguments: []string{"init"}, Text: "files"}}
    owner.SetStep(2)
    Regression.Check(owner.Current.Preview.Ready && owner.Current.Setup.Step == 2, "changing steps keeps the preview")
    owner.SetPath("/tmp")
    Regression.Check(!owner.Current.Preview.Ready && owner.Current.Preview.Text == "", "editing setup discards the preview")

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
