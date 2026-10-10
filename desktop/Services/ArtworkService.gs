package TokateDesktop

import Goo
import Goo.Svg
import System
import System.Collections.Generic
import System.IO
import System.Numerics

/// Painted artwork. Core images load at startup. Page landscapes decode on workers as soon as the service
/// is attached, so they are ready before their page opens, and `changed` runs on the UI thread once each is ready.
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

    shared {
        let Landscapes []string = []string{"donate", "my-project", "saved-work"}
    }

    init() {
        Effect = ShaderEffect(Program)
        LandscapeEffect = ShaderEffect(Program)
    }

    /// Routes landscape completions to the UI thread, notifies `onChanged` after each one, and starts
    /// decoding every landscape.
    func Attach(ui UiDispatcher, onChanged Action) {
        dispatcher = ui
        changed = onChanged
        for name in Landscapes {
            Load(name)
        }
    }

    /// Sets the paint effects for the current light and texture preference.
    func Paint(twilight float64, oilPaint bool) {
        Effect.SetParameter(0, Vector4(float32(twilight), oilPaint ? 1.0F: 0.0F, 0.0F, 0.04F))
        Effect.Playing = false
        LandscapeEffect.SetParameter(0, Vector4(0.0F, oilPaint ? 1.0F: 0.0F, 0.0F, 0.04F))
        LandscapeEffect.Playing = false
    }

    /// The landscape for `name`, or nil while it is still decoding.
    func Scene(name string) Landscape? {
        if landscapes.ContainsKey(name) {
            return landscapes[name]
        }
        Load(name)
        return nil
    }

    private func Load(name string) {
        if !landscapes.ContainsKey(name) && loading.Add(name) {
            go DecodeLandscape(name)
        }
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
