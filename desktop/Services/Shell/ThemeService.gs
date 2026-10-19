package TokateDesktop

import Goo
import Goo.Animations
import System

/// Day and night, paint texture and motion preferences. The twilight animation belongs to the root Cell,
/// which binds it here.
class ThemeService {
    private let window WindowService
    private let changed Action
    private var twilight Anim[float64]?
    var Settings ThemeSettings = ThemeStore.Read()

    init(window WindowService, changed Action) {
        this.window = window
        this.changed = changed
    }

    func Bind(animation Anim[float64]) {
        twilight = animation
    }

    prop Twilight float64 -> twilight?.Value ?? 0

    prop Animated bool -> Settings.Motion && !window.ReducedMotion

    func Toggle() {
        Settings = Settings with{Night = !Settings.Night}
        twilight?.To(Settings.Night ? 1.0: 0.0, Cubic.Tween(Animated ? 1.1: 0.0))
        Save()
    }

    func SetOilPaint(value bool) {
        Settings = Settings with{OilPaint = value}
        Save()
    }

    func SetMotion(value bool) {
        Settings = Settings with{Motion = value}
        Save()
    }

    private func Save() {
        ThemeStore.Write(Settings)
        changed()
    }

    /// Publishes this frame's palette, motion and focus state to `AppTheme`.
    func Apply() {
        AppTheme.Apply(Twilight)
        AppTheme.Motion = Settings.Motion
        AppTheme.FocusVisible = window.FocusVisible
    }
}
