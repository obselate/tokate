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
        if message != "" {
            children.Add(Callout{Message: message, Tone: tone}.Build())
        }
        children.Add(
            DonationStatus{
                Progress: progress,
                Button: page.Button,
                Busy: page.Busy,
                Cancellable: page.BusyHere,
                Stacked: page.Metrics.ContentWidth < 740,
                OnStart: () -> donation.Start(),
                OnInspectSaved: () -> navigate(Destination.Saved),
                OnNew: () -> donation.NewDonation(),
                OnViewSaved: () -> openSaved(directory),
            }.Build()
        )
        children.Add(DonationRun{Progress: progress, Short: page.Metrics.Short, Button: page.Button}.Build())
        return Stack{Gap: 16, Fill: !page.Metrics.Short, Children: children.ToArray()}.Build()
    }
}
