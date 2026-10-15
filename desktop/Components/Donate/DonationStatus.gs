package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System
import System.Collections.Generic

/// A reserved donation in every state: what it waits for, its tool and limits, the elapsed time against
/// the limit, and the action the donor can take next. The state, the time and the actions share one row.
/// `Stacked` puts them in a column.
data struct DonationStatus {
    var Progress DonationProgress
    var Button CommandButton
    var Busy bool
    var Cancellable bool
    var Stacked bool
    var OnStart Action?
    var OnInspectSaved Action?
    var OnNew Action?
    var OnViewSaved Action?

    func Build() Blob {
        let p = AppTheme.Current
        let run = Progress.Run
        let look = AppTheme.Look(Progress.Tone)
        let done = Progress.Started && !Progress.Running
        let stopped = done && Progress.Tone == Tone.Wait
        let icon = Progress.Running ? "auto_awesome": Progress.Ready ? "play_circle": stopped ? "stop_circle": look.Icon
        let heading = Row{
            Children: []Blob{
                MaterialIcons.Create(icon == "" ? "info": icon, 26, look.Edge),
                Heading{Content: Progress.State}.Build(),
            },
        }.Build()
        if Progress.Started {
            heading.Accessibility = Accessibility{Role: AccessibilityRole.Status, Name: Progress.State, Busy: Progress.Running}
        }
        if done && run.State != "" && run.State != "claimed" {
            heading.Children.Add(StatusChip{Value: run.Status, Tone: Statuses.ToneOf(run.Status)}.Build())
        }
        let state = Container{FlexShrink: 1, MinWidth: 0, MaxWidth: AppTheme.WideFieldWidth, Gap: AppTheme.Space8, heading}
        if Progress.Path != "" {
            state.Children.Add(
                Label{
                    Content: (run.Harness == "" ? "": ModelChoice.Tool(run.Harness, run.Provider) + "  ·  ") + ModelChoice.Pair(run.Model, run.Effort),
                    Size: AppTheme.SmallSize,
                    Muted: true,
                }.Build()
            )
        }
        let note = Note(done)
        if note != "" {
            state.Children.Add(Label{Content: note, Size: AppTheme.SmallSize, Muted: true}.Build())
        }
        let row = Container{
            FlexDirection: Stacked ? FlexDirection.Column: FlexDirection.Row,
            AlignItems: Stacked ? AlignItems.Stretch: AlignItems.Center,
            Gap: Stacked ? AppTheme.Space16: AppTheme.Space24,
            state,
        }
        if Progress.Started || run.Unlimited || Progress.Limit > 0 {
            row.Children.Add(Time())
        } else if !Stacked {
            row.Children.Add(Spacer{}.Build())
        }
        row.Children.Add(Row{Children: Actions(done)}.Build())
        return Container{
            FlexShrink: 0,
            Padding: Edges{Left: AppTheme.Space24, Right: AppTheme.Space24, Top: AppTheme.Space16, Bottom: AppTheme.Space16},
            BackgroundColor: p.Surface,
            BorderWidth: 1,
            BorderColor: p.Line,
            BorderRadius: AppTheme.PanelRadius,
            row,
        }
    }

    private func Note(done bool) string {
        if Progress.Ready {
            return "The reservation is approved."
        }
        if !Progress.Started && Progress.Path != "" {
            return "The coordinator must accept this reservation." + (Progress.Polling ? " Tokate checks every 5 seconds.": "")
        }
        return done && Progress.Run.State == "generated" ? "Submit the work from Saved work.": ""
    }

    private func Actions(done bool) []Blob {
        let actions = List[Blob]()
        if Progress.Running {
            actions.Add(CancelButton{Stopping: Button.Stopping, OnCancel: Button.OnCancel}.Build())
        } else if done {
            actions.Add((Button with{Label = "View saved work", OnClick = OnViewSaved, Primary = true}).Build())
            actions.Add((Button with{Label = "New donation", Kind = ButtonKind.Quiet, OnClick = OnNew}).Build())
        } else {
            actions.Add(
                (Button with{Label = "Start donation", OnClick = OnStart, Primary = true, Disabled = !Progress.Ready}).Build()
            )
            if Cancellable {
                actions.Add(CancelButton{Stopping: Button.Stopping, OnCancel: Button.OnCancel}.Build())
            }
            if !Busy && Progress.Path == "" {
                actions.Add((Button with{Label = "Inspect saved work", OnClick = OnInspectSaved}).Build())
            }
        }
        return actions.ToArray()
    }

    /// The clock, the parts of the limit and the bar. Before the start the clock shows the limit. A finished
    /// donation does not show the parts. Unlimited coding time has no bar.
    private func Time() Blob {
        let p = AppTheme.Current
        let run = Progress.Run
        let limit = Progress.Limit
        let time = Container{
            FlexGrow: Stacked ? 0: 1,
            FlexBasis: Stacked ? Length.Auto: Length(0),
            MinWidth: Stacked ? 0: AppTheme.ShortFieldWidth,
            Gap: AppTheme.Space8,
        }
        if !Progress.Started && run.Unlimited {
            time.Children.Add(Label{Content: "Unlimited coding time"}.Build())
            return time
        }
        let clock = DonationProgress.Clock(Progress.Started ? Progress.Elapsed: limit)
        let readout = Row{
            Align: AlignItems.Baseline,
            Gap: AppTheme.Space12,
            Children: []Blob{
                Text{
                    Content: clock,
                    FontFamily: AppTheme.MonoFont,
                    FontSize: AppTheme.TitleSize,
                    Color: p.Ink,
                    Accessibility: Accessibility{
                        Role: AccessibilityRole.Text,
                        Name: Progress.Started ? "Elapsed " + DonationProgress.ElapsedText(Progress.Elapsed): "Limit " + clock,
                    },
                },
                Label{
                    Content: !Progress.Started ? "limit": limit == 0 ? "elapsed": "of " + DonationProgress.Clock(limit),
                    Size: AppTheme.SmallSize,
                    Muted: true,
                }.Build(),
            },
        }.Build()
        time.Children.Add(readout)
        if limit > 0 && (Progress.Running || !Progress.Started) {
            readout.Children.Add(Spacer{}.Build())
            readout.Children.Add(
                Label{
                    Content: "Coding " + (run.CodingSeconds / 60).ToString() + " min  ·  Verification " + (
                        run.VerificationReserve / 60
                    ).ToString() + " min",
                    Size: AppTheme.SmallSize,
                    Muted: true,
                }.Build()
            )
        }
        if limit > 0 {
            time.Children.Add(
                Meter{
                    Value: Progress.Started ? float64(Progress.Elapsed) / float64(limit): 0,
                    Parts: []float64{float64(run.CodingSeconds), float64(run.VerificationReserve)},
                }.Build()
            )
        }
        return time
    }
}
