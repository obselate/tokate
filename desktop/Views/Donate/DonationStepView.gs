package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// Step IV: a reserved donation from the request to the result, above its output.
class DonationStepView {
    private let donation DonationService
    private let navigate Action[Destination]
    private let openSaved Action[string]

    init(donation DonationService, navigate Action[Destination], openSaved Action[string]) {
        this.donation = donation
        this.navigate = navigate
        this.openSaved = openSaved
    }

    func Build(page PageContext, header Blob, message string, tone Tone) Blob {
        let progress = donation.Current.Progress
        let directory = progress.Path
        let children = List[Blob]{header}
        if donation.Current.RepositoryMode {
            children.Add(Callout{Message: progress.State, Tone: progress.Tone}.Build())
            if progress.Running {
                children.Add((page.Button with{
                    Label = donation.Current.StopRequested ? "Stopping after current task": "Stop repository donation",
                    AllowWhileBusy = true,
                    Disabled = donation.Current.StopRequested,
                    OnClick = () -> donation.StopRepository(),
                }).Build())
            } else {
                let session = donation.Current.Session
                children.Add(Label{Content: "Reason: " + session.Reason}.Build())
                children.Add(Label{
                    Content: "Submitted: " + session.Submitted.ToString() + "   Skipped: " + session.Skipped.ToString() + "   Failed: " + session.Failed.ToString(),
                }.Build())
                children.Add(Label{Content: "Usage: " + session.Usage + "\nWall time: " + session.WallSeconds + " seconds"}.Build())
                for task in session.Tasks ?? []DonationTask{} {
                    children.Add(Label{Content: "#" + task.Issue + " " + task.Result + (task.Reason == "" ? "": "\n" + task.Reason)}.Build())
                    if task.PullRequest != "" {
                        let url = task.PullRequest
                        children.Add((page.Button with{Label = "Open pull request", OnClick = () -> Browser.Open(url)}).Build())
                    }
                    if task.Directory != "" {
                        let path = task.Directory
                        children.Add((page.Button with{Label = "View saved task", OnClick = () -> openSaved(path)}).Build())
                    }
                }
                children.Add((page.Button with{Label = "New donation", OnClick = () -> donation.NewDonation()}).Build())
            }
            if message != "" {
                children.Add(Callout{Message: message, Tone: tone}.Build())
            }
            children.Add(DonationRun{Progress: progress, Short: page.Metrics.Short, Button: page.Button}.Build())
            return Stack{Gap: AppTheme.SectionGap, Fill: !page.Metrics.Short, Children: children.ToArray()}.Build()
        }
        if message != "" {
            children.Add(Callout{Message: message, Tone: tone}.Build())
        }
        if progress.Run.Warning != "" {
            children.Add(Callout{Message: progress.Run.Warning, Tone: Tone.Need}.Build())
        }
        if progress.Run.Guidance != "" {
            children.Add(Callout{Message: progress.Run.Guidance, Tone: Tone.Need}.Build())
        }
        children.Add(
            DonationStatus{
                Progress: progress,
                Button: page.Button,
                Busy: page.Busy,
                Cancellable: page.BusyHere,
                Stacked: page.Metrics.ContentWidth < AppTheme.ColumnsBreakpoint,
                OnStart: () -> donation.Start(),
                OnInspectSaved: () -> navigate(Destination.Saved),
                OnNew: () -> donation.NewDonation(),
                OnViewSaved: () -> openSaved(directory),
            }.Build()
        )
        children.Add(DonationRun{Progress: progress, Short: page.Metrics.Short, Button: page.Button}.Build())
        return Stack{Gap: AppTheme.SectionGap, Fill: !page.Metrics.Short, Children: children.ToArray()}.Build()
    }
}
