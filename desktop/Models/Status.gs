package TokateDesktop

import System

/// Sorts status labels into tones by who must act next. A label that is not listed waits on another person.
class Statuses {
    shared {
        let Need []string = []string{
            "Ready to submit",
            "Needs amendment",
            "Claimed, not started",
            "Access requested",
            "Needs approval",
            "Needs review",
            "generated",
            "incomplete generated",
            "verified",
            "claimed",
        }
        let Done []string = []string{"Merged", "Approved", "Trusted", "Issue access", "completed"}
        let Failed []string = []string{
            "CI failed",
            "Verification failed",
            "Initial donation failed",
            "Closed without merge",
            "Unavailable",
            "Review unavailable",
            "Denied",
            "failed",
            "interrupted",
            "unavailable",
            "stale remote data",
        }

        func ToneOf(status string) Tone -> Array.IndexOf(Need, status) >= 0 ? Tone.Need: Array.IndexOf(Done, status) >= 0 ?
        Tone.Done: Array.IndexOf(Failed, status) >= 0 ? Tone.Fail: Tone.Wait
    }
}
