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

    func Build(page PageContext, header Blob) Blob {
        let progress = donation.Current.Progress
        let directory = progress.Path
        let children = List[Blob]()
        let notices = List[Blob]()
        if donation.Current.RepositoryMode {
            notices.Add(Callout{Message: progress.State, Tone: progress.Running ? Tone.Wait: progress.Tone}.Build())
            if progress.Running {
                children.Add(Panel{Name: "Repository donation", Children: []Blob{
                    IconHeading{Icon: "volunteer_activism", Content: donation.Current.Repository}.Build(),
                    page.Loader?.Invoke(donation.Current.StopRequested ? "Finishing the current task": "Donating inference") ?? Loader{Message: "Donating inference", Key: "donation-ambient"}.Build(),
                    ActionBar{Children: []Blob{
                        (page.Button with{
                            Label = donation.Current.StopRequested ? "Stopping after current task": "Stop after current task",
                            Tone = ButtonTone.Danger,
                            AllowWhileBusy = true,
                            Disabled = donation.Current.StopRequested,
                            OnClick = () -> donation.StopRepository(),
                        }).Build(),
                    }}.Build(),
                }}.Build())
            } else {
                let session = donation.Current.Session
                children.Add(Panel{Name: "Donation results", Children: []Blob{
                    IconHeading{Icon: "volunteer_activism", Content: donation.Current.Repository}.Build(),
                    Row{Children: []Blob{
                        StatTile{Title: "Submitted", Value: session.Submitted.ToString(), Icon: "check_circle"}.Build(),
                        StatTile{Title: "Skipped", Value: session.Skipped.ToString(), Icon: "skip_next"}.Build(),
                        StatTile{Title: "Failed", Value: session.Failed.ToString(), Icon: "error"}.Build(),
                        StatTile{Title: "Time", Value: session.WallSeconds, Icon: "schedule"}.Build(),
                        StatTile{Title: "Tokens", Value: session.Usage, Icon: "token"}.Build(),
                    }}.Build(),
                    DetailRow{Caption: "End reason", Value: session.EndReason}.Build(),
                }}.Build())
                children.Add(DonationTasks{Tasks: session.Tasks, ReviewEach: donation.Current.ReviewEach, Button: page.Button, OnSaved: openSaved}.Build())
                children.Add(ActionBar{Children: []Blob{(page.Button with{Label = "New donation", OnClick = () -> donation.NewDonation()}).Build()}}.Build())
            }
            if progress.Running { children.Add(DonationRun{Progress: progress, Short: page.Metrics.Short, Button: page.Button}.Build()) }
            return page.Layout(header, children.ToArray(), fill: progress.Running && !page.Metrics.Short, notices: notices.ToArray())
        }
        if progress.Run.Warning != "" {
            notices.Add(Callout{Message: progress.Run.Warning, Tone: Tone.Need}.Build())
        }
        if progress.Run.Guidance != "" {
            notices.Add(Callout{Message: progress.Run.Guidance, Tone: Tone.Need}.Build())
        }
        children.Add(
            DonationStatus{
                Progress: progress,
                Button: page.Button,
                Busy: page.Busy,
                Cancellable: page.BusyHere,
                Stacked: page.Metrics.ContentWidth < AppTheme.ColumnsBreakpoint,
                Ambient: progress.Running ? page.Loader?.Invoke("Donating inference"): nil,
                OnStart: () -> donation.Start(),
                OnInspectSaved: () -> navigate(Destination.Saved),
                OnNew: () -> donation.NewDonation(),
                OnViewSaved: () -> openSaved(directory),
            }.Build()
        )
        children.Add(DonationRun{Progress: progress, Short: page.Metrics.Short, Button: page.Button}.Build())
        return page.Layout(header, children.ToArray(), fill: !page.Metrics.Short, notices: notices.ToArray())
    }
}
