package TokateDesktop

import System
import System.Diagnostics

/// A running command started with `ActivityService.Begin`.
class ActivityTicket {
    let Runner Cancellable
    let Clock Stopwatch = Stopwatch.StartNew()
    let Progress Action[int32, string]?

    init(runner Cancellable, progress Action[int32, string]?) {
        Runner = runner
        Progress = progress
    }
}

/// The single command that may run at a time.
///
/// Callers `Begin` on the UI thread, run the command in a named `go` worker function (so suspension stays
/// inferred), and call `Complete` from that worker. Completion returns to the UI thread through the window
/// dispatcher; `finish` runs after the activity is idle and may begin a follow-up command, which keeps the
/// original page and visibility.
class ActivityService {
    private let window WindowService
    private let navigation NavigationService
    private let feedback FeedbackService
    private let changed Action
    private var job Cancellable?
    private var timer IDisposable?
    var Current Activity = Activity.Idle

    init(window WindowService, navigation NavigationService, feedback FeedbackService, changed Action) {
        this.window = window
        this.navigation = navigation
        this.feedback = feedback
        this.changed = changed
    }

    prop Busy bool -> Current.Busy

    /// Records which control started the next command, so that control can become its cancel button.
    func Activate(label string) {
        Current = Current with{ActionName = label}
    }

    func Cancel() {
        Current = Current with{Stopping = true}
        job?.Stop()
        changed()
    }

    /// Starts tracking a command, or returns nil when one is already running. Streaming activities poll
    /// `runner.RecentOutput()` and pass it to `progress`.
    func Begin(
        command string,
        runner Cancellable,
        streaming bool = false,
        progress Action[int32, string]? = nil
    ) ActivityTicket? {
        if Current.Busy {
            return nil
        }
        let chained = job != nil
        job = runner
        feedback.Clear()
        Current = Current with{
            Busy = true,
            Title = Activity.TitleFor(command),
            Elapsed = 0,
            Output = "",
            Stopping = false,
            Streaming = streaming,
            Page = chained ? Current.Page: navigation.Current,
            Visible = chained ? Current.Visible: false,
        }
        let ticket = ActivityTicket(runner, progress)
        timer = window.Every(
            250,
            () -> {
                let seconds = int32(ticket.Clock.Elapsed.TotalSeconds)
                let output = streaming ? runner.RecentOutput(): ""
                if !Current.Visible || Current.Elapsed != seconds || Current.Output != output {
                    Current = Current with{Visible = true, Elapsed = seconds, Output = output}
                    ticket.Progress?.Invoke(seconds, output)
                    changed()
                }
            }
        )
        changed()
        return ticket
    }

    /// Reports a finished command from its worker. `finish` runs on the UI thread with `result`.
    func Complete[R](ticket ActivityTicket, result R, finish Action[R]) {
        window.Dispatcher.TryPost(() -> Finish(ticket, result, finish))
    }

    private func Finish[R](ticket ActivityTicket, result R, finish Action[R]) {
        let output = ticket.Runner.RecentOutput()
        let elapsed = int32(ticket.Clock.Elapsed.TotalSeconds)
        Current = Current with{Output = output, Elapsed = elapsed}
        ticket.Progress?.Invoke(elapsed, output)
        timer?.Dispose()
        timer = nil
        Current = Current with{Busy = false}
        finish(result)
        if !Current.Busy {
            job = nil
            Current = Current with{Streaming = false}
        }
        changed()
    }
}
