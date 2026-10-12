package TokateDesktop

import System
import System.IO

/// Keeps the appearance choices between starts, in a file under the XDG state home.
class ThemeStore {
    shared {
        private func Location() string {
            let configured = Environment.GetEnvironmentVariable("XDG_STATE_HOME") ?? ""
            let home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local/state")
            return Path.Combine(Path.IsPathFullyQualified(configured) ? configured: home, "tokate-desktop", "appearance.json")
        }

        /// The saved choices, or the initial ones when no readable file exists.
        func Read() ThemeSettings {
            try {
                let saved = Json.ParseFile(Location())
                return ThemeSettings{
                    Night: Json.Bool(saved, "night"),
                    OilPaint: Json.BoolOrNil(saved, "oil_paint") ?? true,
                    Motion: Json.BoolOrNil(saved, "motion") ?? true,
                }
            } catch (error Exception) {
                return ThemeSettings.Initial
            }
        }

        func Write(settings ThemeSettings) {
            try {
                Directory.CreateDirectory(Path.GetDirectoryName(Location())!!)
                File.WriteAllText(Location(), Json.Appearance(settings))
            } catch (error Exception) {
            }
        }
    }
}
