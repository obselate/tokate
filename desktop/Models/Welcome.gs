package TokateDesktop

/// What the welcome page shows on top of its three choices.
data struct WelcomeState {
    /// The most recently changed saved contribution, when it can be read.
    var Latest SavedRun?
    /// True when the GitHub CLI reports that no account is signed in.
    var SignedOut bool
}
