package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System
import System.Collections.Generic

/// A reserved donation in every state: what it waits for, its tool and limits, the elapsed time against
/// the limit, and the action the donor can take next. `Stacked` puts the time below the state.
data struct DonationStatus {
    var Progress DonationProgress
    var Message string
    var MessageTone Tone
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
            heading.Children.Add(StatusBadge{Value: run.Status, Tone: Statuses.ToneOf(run.Status)}.Build())
        }
        let state = Container{FlexGrow: 1, FlexBasis: Stacked ? Length.Auto: Length(0), MinWidth: 0, Gap: 10, heading}
        let note = Note(done)
        if note != "" {
            state.Children.Add(Label{Content: note, Size: AppTheme.SmallSize, Muted: true}.Build())
        }
        if Message != "" {
            state.Children.Add(Callout{Message: Message, Tone: MessageTone}.Build())
        }
        if Progress.Path != "" {
            state.Children.Add(
                Label{
                    Content: (run.Harness == "" ? "": run.Harness + "  ·  ") + run.Model + " / " + run.Effort + "  ·  " + (
                        run.Network ? "Network allowed": "Network offline"
                    ),
                    Size: AppTheme.SmallSize,
                    Muted: true,
                }.Build()
            )
        }
        state.Children.Add(Row{Children: Actions(done)}.Build())
        let band = Container{
            FlexDirection: Stacked ? FlexDirection.Column: FlexDirection.Row,
            FlexShrink: 0,
            Gap: Stacked ? 16: 28,
            Padding: Edges{Left: 22, Right: 22, Top: 18, Bottom: 18},
            BackgroundColor: p.Surface,
            BorderWidth: 1,
            BorderColor: p.Line,
            BorderRadius: AppTheme.PanelRadius,
            state,
        }
        if Progress.Started || run.Unlimited || Progress.Limit > 0 {
            band.Children.Add(Time())
        }
        return band
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

    /// The clock and the bar. Before the start the clock shows the limit. Unlimited coding time has no bar.
    private func Time() Blob {
        let p = AppTheme.Current
        let run = Progress.Run
        let limit = Progress.Limit
        let time = Container{
            Width: Stacked ? Length.Auto: Length(320),
            FlexShrink: 0,
            Gap: 8,
            JustifyContent: JustifyContent.Center,
            Padding: Stacked ? Edges{Top: 16}: Edges{Left: 28},
            BorderWidth: Stacked ? Edges{Top: 1}: Edges{Left: 1},
            BorderColor: p.Line,
        }
        if !Progress.Started && run.Unlimited {
            time.Children.Add(Label{Content: "Unlimited coding time"}.Build())
            return time
        }
        let clock = DonationProgress.Clock(Progress.Started ? Progress.Elapsed: limit)
        time.Children.Add(
            Row{
                Align: AlignItems.Baseline,
                Gap: 10,
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
        )
        if limit > 0 {
            time.Children.Add(
                Meter{
                    Value: Progress.Started ? float64(Progress.Elapsed) / float64(limit): 0,
                    Parts: []float64{float64(run.CodingSeconds), float64(run.VerificationReserve)},
                    Labels: []string{
                        "Coding " + (run.CodingSeconds / 60).ToString() + " min",
                        "Verification " + (run.VerificationReserve / 60).ToString() + " min",
                    },
                }.Build()
            )
        }
        return time
    }
}
