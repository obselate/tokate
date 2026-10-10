package TokateDesktop

import Goo
import Goo.Svg
import System
import System.Collections.Generic
import System.IO

/// Painted artwork. Core images load at startup; page landscapes decode on a worker the first time they
/// are requested, and `changed` runs on the UI thread once one is ready.
class ArtworkService : IDisposable {
    let Backdrop ImageSource = ImageSource.Decode(File.ReadAllBytes(Asset("backdrop.png")))
    let Hands ImageSource = ImageSource.Decode(File.ReadAllBytes(Asset("hands-smooth.png")))
    let Sun ImageSource = ImageSource.Decode(File.ReadAllBytes(Asset("sun.png")))
    let Moon ImageSource = ImageSource.Decode(File.ReadAllBytes(Asset("moon.png")))
    let Stone ImageSource = ImageSource.Decode(File.ReadAllBytes(Asset("stone-olive.png")))
    let Mark VectorAsset = Svg.Load(Asset("wordmark-sprig.svg"))
    let Program ShaderEffectProgram = ShaderEffectProgram.Load(
        Path.Combine(AppContext.BaseDirectory, "Shaders/fresco.goo-effect")
    )
    let Effect ShaderEffect
    let LandscapeEffect ShaderEffect
    private let landscapes Dictionary[string, Landscape] = Dictionary[string, Landscape]()
    private let loading HashSet[string] = HashSet[string]()
    private var dispatcher UiDispatcher = UiDispatcher.Inline()
    private var changed Action = () -> { }
    private var disposed bool

    init() {
        Effect = ShaderEffect(Program)
        LandscapeEffect = ShaderEffect(Program)
    }

    /// Routes landscape completions to the UI thread and notifies `onChanged` after each one.
    func Attach(ui UiDispatcher, onChanged Action) {
        dispatcher = ui
        changed = onChanged
    }

    /// The landscape for `name`, or nil while it is still decoding.
    func Scene(name string) Landscape? {
        if landscapes.ContainsKey(name) {
            return landscapes[name]
        }
        if loading.Add(name) {
            go DecodeLandscape(name)
        }
        return nil
    }

    private func DecodeLandscape(name string) {
        var decoded Landscape?
        try {
            decoded = Landscape(name)
        } catch (error Exception) {
            return
        }
        let image = decoded!!
        let posted = dispatcher.TryPost(
            () -> {
                loading.Remove(name)
                if disposed {
                    image.Dispose()
                    return
                }
                landscapes[name] = image
                changed()
            }
        )
        if !posted {
            image.Dispose()
        }
    }

    func Dispose() {
        disposed = true
        Backdrop.Dispose()
        Hands.Dispose()
        Sun.Dispose()
        Moon.Dispose()
        Stone.Dispose()
        for image in landscapes.Values {
            image.Dispose()
        }
        landscapes.Clear()
    }
}

class Landscape : IDisposable {
    let Daylight ImageSource
    let Moonlight ImageSource

    init(name string) {
        Daylight = ImageSource.Decode(File.ReadAllBytes(Asset(name + "-daylight.png")))
        Moonlight = ImageSource.Decode(File.ReadAllBytes(Asset(name + "-moonlight.png")))
    }

    func Dispose() {
        Daylight.Dispose()
        Moonlight.Dispose()
    }
}

func Asset(name string) string -> Path.Combine(AppContext.BaseDirectory, "Assets", name)
