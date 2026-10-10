package TokateDesktop

import System
import System.Diagnostics

class Browser {
    shared {
        /// Opens a github.com HTTPS link in the default browser. Other links are ignored.
        func Open(url string) {
            if Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == "https" && uri.Host == "github.com" {
                go Launch(url)
            }
        }

        private func Launch(url string) {
            try {
                Process.Start(ProcessStartInfo{FileName: "xdg-open", UseShellExecute: false, ArgumentList: {url}})?.Dispose()
            } catch (error Exception) { }
        }
    }
}
