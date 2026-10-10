package TokateDesktop

import Goo
import System

/// Step IV: a reserved donation waiting to start, then its live output.
class DonationStepView {
    private let donation DonationService
    private let navigate Action[Destination]
    private let openSaved Action[string]

    init(donation DonationService, navigate Action[Destination], openSaved Action[string]) {
        this.donation = donation
        this.navigate = navigate
        this.openSaved = openSaved
    }

    func Build(page PageContext, header Blob, message string) Blob {
        let state = donation.Current
        let progress = state.Progress
        let run = progress.Run
        let started = progress.Started
        let body = Stack{
            Gap: 18,
            Fill: started && !page.Metrics.Short,
            Children: []Blob{
                header,
                Label{Content: progress.Path == "" ? state.Identity: run.Identity, Size: 21}.Build(),
            },
        }.Build()
        if !started {
            body.Children.Add(
                DonationStatus{
                    Progress: progress,
                    Message: message,
                    Button: page.Button,
                    Busy: page.Busy,
                    Cancellable: page.BusyHere,
                    Compact: page.CompactPanels,
                    OnStart: () -> donation.Start(),
                    OnInspectSaved: () -> navigate(Destination.Saved),
                }.Build()
            )
            return body
        }
        if message != "" {
            body.Children.Add(Label{Content: message, Size: 17}.Build())
        }
        let directory = progress.Path
        body.Children.Add(
            DonationRun{
                Progress: progress,
                Short: page.Metrics.Short,
                Button: page.Button,
                OnNew: () -> donation.NewDonation(),
                OnViewSaved: () -> openSaved(directory),
            }.Build()
        )
        return body
    }
}
