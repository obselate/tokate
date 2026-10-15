package TokateDesktop

import Goo
import System
import System.IO
import System.Collections.Generic

data struct DonationTasks {
    var Tasks []DonationTask
    var ReviewEach bool
    var Button CommandButton
    var OnSaved Action[string]?

    func Build() Blob {
        let rows = List[Blob]()
        let saved = OnSaved
        for task in Tasks ?? []DonationTask{} {
            let ready = ReviewEach && task.Directory != "" && task.PullRequest == "" && task.Result != "failed" && task.Result != "skipped"
            let url = task.PullRequest
            let path = task.Directory
            rows.Add(ListRow{Name: "Task " + task.Issue, Children: []Blob{Container{
                FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Gap: AppTheme.Space12,
                Children: []Blob{
                Row{Children: []Blob{
                    Container{FlexGrow: 1, MinWidth: AppTheme.ShortFieldWidth, Row{Gap: AppTheme.Space8, Children: []Blob{
                        Heading{Content: task.Issue == "" ? "Task": "#" + task.Issue, Size: AppTheme.ItemSize}.Build(),
                        StatusChip{Value: ready ? "Ready to submit": task.Result, Tone: task.Result == "failed" ? Tone.Fail: task.Result == "submitted" ? Tone.Done: Tone.Wait}.Build(),
                    }}.Build()},
                    url != "" ? (Button with{Label = "Open PR", Name = "Open pull request " + task.Issue, Tone = ButtonTone.Positive, OnClick = () -> Browser.Open(url)}).Build(): Container{},
                    path != "" ? (Button with{Label = "Open saved run", Name = "Open saved run " + task.Issue, OnClick = () -> saved?.Invoke(path)}).Build(): Container{},
                }}.Build(),
                task.Reason != "" ? Label{Content: task.Reason, Muted: true, Size: AppTheme.SmallSize}.Build(): Container{},
                path != "" ? Container{Children: []Blob{Cell.Mount[DonationTaskOutputInput, DonationTaskOutput]("task-output-" + path, DonationTaskOutputInput{Directory: path, Twilight: AppTheme.Twilight})}}: Container{},
                },
            }}}.Build())
        }
        if rows.Count == 0 { rows.Add(Label{Content: "No tasks completed", Muted: true}.Build()) }
        return Panel{Name: "Completed tasks", Children: []Blob{ListSection{Title: "Tasks", Count: rows.Count, Children: rows.ToArray()}.Build()}}.Build()
    }
}

data struct DonationTaskOutputInput {
    var Directory string
    var Twilight float64
}

open class DonationTaskOutput : Cell[DonationTaskOutputInput] {
    private var expanded bool
    private var loaded bool
    private var lines []string = []string{}
    private var message string = ""

    private func Toggle(directory string) {
        expanded = !expanded
        if expanded && !loaded {
            loaded = true
            try {
                let report = Path.Combine(directory, "report.md")
                let path = File.Exists(report) ? report: Path.Combine(directory, "stderr.log")
                if File.Exists(path) {
                    let visible = List[string]()
                    using let reader = File.OpenText(path)
                    while visible.Count < 200 {
                        let line = reader.ReadLine()
                        if line == nil { break }
                        visible.Add(line)
                    }
                    lines = visible.ToArray()
                    message = reader.Peek() >= 0 ? "First 200 lines · Open saved run for full output": ""
                } else {
                    message = "No saved report or error output"
                }
            } catch (error Exception) when error is IOException || error is UnauthorizedAccessException {
                message = "Saved output is unavailable"
            }
        }
        Rebuild()
    }

    protected override func Build(input DonationTaskOutputInput) Blob {
        let body = List[Blob]()
        if expanded {
            for line in lines { body.Add(Label{Content: line, Mono: true, Size: AppTheme.SmallSize}.Build()) }
            if message != "" { body.Add(Label{Content: message, Muted: true, Size: AppTheme.SmallSize}.Build()) }
        }
        return OutputPanel{Title: "Task output", LineCount: loaded ? lines.Length: -1, Collapsible: true, Expanded: expanded, OnToggle: () -> Toggle(input.Directory), Children: []Blob{Container{Padding: AppTheme.Space16, Gap: AppTheme.Space4, Children: body.ToArray()}}}.Build()
    }
}
