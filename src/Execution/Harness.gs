package Tokate

import System
import System.Collections.Generic
import System.Text.Json

internal class Evidence {
    internal var Report string = ""
    internal var Usage Dictionary[string, Object?] = map[string, Object?]{}
    internal var Model string? = nil
}

internal class Harness(
    title string,
    billing string,
    provider string,
    hint string,
    label string,
    prepare Func[
        string,
        Data,
        JsonElement,
        RuntimeBudget,
        Func[string, string, string, List[string]?],
        ValueTuple[[]string, Action[Data]?]
    ],
    read Func[string, Data, JsonElement, CommandResult, Func[string, bool], Evidence],
    activity Action[string],
    choose Func[Args, Func[Dictionary[string, Object?]], JsonElement]? = nil,
    validateSaved Action[Data]? = nil,
    doctor Action[Args, ToolCheck]? = nil,
    beforeRun Action[Data, RuntimeBudget]? = nil,
    pair Func[string, string, bool]? = nil,
    options[]string? = nil,
    tools[]string? = nil,
    catalog bool = false,
    continues bool = true,
    nix string = "",
    installer string = "",
    config string = ""
) {
    internal let Title string = title
    internal let Billing string = billing
    internal let Provider string = provider
    internal let Hint string = hint
    internal let Label string = label
    internal let Prepare Func[
        string,
        Data,
        JsonElement,
        RuntimeBudget,
        Func[string, string, string, List[string]?],
        ValueTuple[[]string, Action[Data]?]
    ] = prepare
    internal let Read Func[string, Data, JsonElement, CommandResult, Func[string, bool], Evidence] = read
    internal let Activity Action[string] = activity
    internal let Select Func[Args, Func[Dictionary[string, Object?]], JsonElement]? = choose
    internal let ValidateSaved Action[Data]? = validateSaved
    internal let Doctor Action[Args, ToolCheck]? = doctor
    internal let BeforeRun Action[Data, RuntimeBudget]? = beforeRun
    internal let Pair Func[string, string, bool]? = pair
    internal let Options[]string = options ?? []string{}
    internal let Tools[]string = tools ?? []string{}
    internal let Catalog bool = catalog
    internal let Continues bool = continues
    internal let Nix string = nix
    internal let Installer string = installer
    internal let Config string = config

    shared {
        private const PiInstallerUrl string = "https://pi.dev/install.sh"

        internal let Table Dictionary[string, Harness] = map[string, Harness]{
            "codex": Harness(
                "Codex",
                "Subscription",
                "openai",
                "Add native Linux x64 Codex or the @openai/codex npm launcher with its matching codex-linux-x64 native runtime to PATH; user-local installations are supported. Use --harness-path FILE for a custom location.",
                "Inference",
                Worker.Prepare,
                Worker.Read,
                Worker.Activity,
                nix: "nixpkgs#codex",
                config: ".codex"
            ),
            "pi": Harness(
                "Pi",
                "Local",
                "local-chat-completions",
                "Use --harness-path FILE, or --pi-root DIR and --node FILE for an existing installation.",
                "Pi inference",
                PiHarness.Prepare,
                PiHarness.Read,
                PiHarness.Activity,
                PiHarness.Select,
                PiHarness.ValidateSaved,
                PiHarness.Doctor,
                PiHarness.BeforeRun,
                options: []string{"endpoint", "pi-root", "node"},
                tools: []string{"/bin/bash"},
                catalog: true,
                nix: "github:earendil-works/pi/stable",
                installer: PiInstallerUrl
            ),
            "claude": Harness(
                "Claude Code",
                "Subscription",
                "anthropic",
                "Use an installed Claude Code with its existing login.",
                "Claude inference",
                ClaudeHarness.Prepare,
                ClaudeHarness.Read,
                ClaudeHarness.Activity,
                ClaudeHarness.Select,
                ClaudeHarness.ValidateSaved,
                ClaudeHarness.Doctor,
                pair: ClaudeCode.Pair,
                options: []string{"claude-profile"},
                tools: []string{"/bin/bash", "bwrap", "socat"},
                continues: false
            ),
            "omp": Harness(
                "OMP",
                "",
                "",
                "Install OMP with its official installer and sign in, or use --harness-path FILE.",
                "OMP inference",
                OmpHarness.Prepare,
                OmpHarness.Read,
                OmpHarness.Activity,
                OmpHarness.Select,
                OmpHarness.ValidateSaved,
                OmpHarness.Doctor,
                catalog: true
            )
        }

        internal func Find(name string) Harness? -> Table.ContainsKey(name) ? Table[name]: nil

        internal func DefaultProvider(name string) string -> Find(name)?.Provider ?? ""

        internal func Accepts(name string, provider string) bool -> Find(name) is Harness adapter &&
            (adapter.Provider == "" || adapter.Provider == provider)

        internal func Describe(name string, provider string) string {
            let billing = Find(name)?.Billing ?? ""
            return (Find(name)?.Title ?? name) + " (" + (billing == "" ? provider: billing) + ")"
        }

        internal func Owns(name string, option string) bool {
            let options = Find(name)?.Options ?? []string{}
            return Array.IndexOf(options, option) >= 0
        }

        internal func Resumes(name string, provider string) bool -> Find(name)?.Continues == true &&
            Accepts(name, provider)
    }
}
