package TokateDesktop

/// Work that can be stopped and that exposes its recent diagnostics output.
interface Cancellable {
    func Stop();
    func RecentOutput() string;
}
