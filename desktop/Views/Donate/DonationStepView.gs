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
                children.Add(Row{Children: []Blob{
                    (page.Button with{
                        Label = donation.Current.StopRequested ? "Stopping after current task": "Stop after current task",
                        AllowWhileBusy = true,
                        Disabled = donation.Current.StopRequested,
                        OnClick = () -> donation.StopRepository(),
                    }).Build(),
                    Label{Content: "Elapsed " + DonationProgress.Clock(progress.Elapsed), Muted: true}.Build(),
                }}.Build())
            } else {
                let session = donation.Current.Session
                children.Add(Label{Content: "Reason: " + session.Reason}.Build())
                children.Add(Label{
                    Content: "Submitted: " + session.Submitted.ToString() + "   Skipped: " + session.Skipped.ToString() + "   Failed: " + session.Failed.ToString(),
                }.Build())
                children.Add(Label{Content: "Usage: " + session.Usage + " · Wall time: " + session.WallSeconds}.Build())
                children.Add(DonationTasks{Tasks: session.Tasks, ReviewEach: donation.Current.ReviewEach, Button: page.Button, OnSaved: openSaved}.Build())
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
