package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class DonorSelection {
    shared {
        internal func Interactive(args Args) bool -> !PublicOutput.Enabled && args.Get("non-interactive") != "true" &&
            !Console.IsInputRedirected &&
            !Console.IsOutputRedirected &&
            !Console.IsErrorRedirected

        internal func Supported(value JsonElement) bool ->
        (J.Text(value, "harness") == "codex" && J.Text(value, "provider") == "openai") ||
            (J.Text(value, "harness") == "pi" && J.Text(value, "provider") == "local-chat-completions") ||
            (J.Text(value, "harness") == "claude" && J.Text(value, "provider") == "anthropic") ||
            (J.Text(value, "harness") == "omp" && J.Text(value, "provider") != "")

        internal func Managed(saved JsonElement) bool -> Supported(saved) || J.Text(saved, "harness") == "omp"

        internal func ApplyDefaults(args Args) {
            if args.Get("run") != "" || args.Get("source") == "external" ||
                (
                args.Command != "select" &&
                    args.Command != "claim" &&
                    args.Command != "work" &&
                    (args.Command != "prepare" || args.Get("source") != "tokate")
            ) {
                return
            }

            let profile = args.Get("profile")
            var saved JsonElement

            try {
                saved = DonorDefaults.Read(profile)
            } catch (error Exception) {
                if profile != "" {
                    throw Exception(
                        "Named donor profile is invalid, missing or inaccessible; use defaults show NAME. No inference started."
                    )
                }

                return
            }

            args.SavedDefaults = saved

            let harness = J.Text(saved, "harness")
            let provider = J.Text(saved, "provider")
            let compatible = (args.Get("harness") == "" || args.Get("harness") == harness) &&
                (args.Get("provider") == "" || args.Get("provider") == provider)
            if compatible && harness != "" && J.Text(saved, "model") == "" && !Managed(saved) {
                throw Exception(
                    "The selected " +
                        harness +
                        " profile uses external work. Use that harness for external work or override --harness with a managed tool. No inference started."
                )
            }

            if !Managed(saved) || !compatible {
                if profile != "" {
                    throw Exception(
                        "Named donor profile conflicts with the selected managed harness/provider. No inference started."
                    )
                }

                return
            }

            for key in[]string{
                "harness",
                "provider",
                "endpoint",
                "pi-root",
                "node",
                "harness-path",
                "claude-profile",
            } {
                if args.Get(key) == "" && J.Text(saved, key) != "" {
                    args.Values["--" + key] = J.Text(saved, key)
                }
            }
        }

        internal func Resolve(args Args, policy Policy) JsonElement {
            DonorDefaults.NormalizePair(args)

            let harness = args.Get("harness", "codex")

            if harness == "omp" && args.Get("provider") == "" {
                let allowed = policy.Providers("omp")

                if allowed.Count != 1 {
                    throw Exception(
                        "Choose --provider for OMP: the owner policy allows " +
                            (allowed.Count == 0 ? "no OMP provider": String.Join(", ", allowed)) +
                            ". No inference started."
                    )
                }

                args.Values["--provider"] = allowed[0]
            }

            let provider = args.Get("provider", "openai")

            if harness != "claude" && (args.Get("claude-profile") != "") {
                throw Exception("Claude profile options require the claude harness")
            }

            if harness != "pi" && (args.Get("endpoint") != "" || args.Get("pi-root") != "" || args.Get("node") != "") {
                throw Exception("Pi runtime options require the pi harness")
            }

            let saved = args.SavedDefaults
            var reason = "No usable saved default."
            let compatible = J.Text(saved, "harness") == harness && J.Text(saved, "provider") == provider
            var model = args.Get("model", compatible ? J.Text(saved, "model"): "")
            var effort = args.Get("effort", compatible ? J.Text(saved, "effort"): "")
            let explicitPair = args.Get("model") != "" || args.Get("effort") != ""
            var overridden = explicitPair

            for key in[]string{"endpoint", "pi-root", "node", "harness-path", "claude-profile"} {
                overridden = overridden || (args.Get(key) != "" && args.Get(key) != J.Text(saved, key))
            }

            var source = args.Get("profile") != "" ? "saved donor profile " + args.Get("profile") +
                (overridden ? " with explicit overrides": ""): (
                explicitPair ? "explicit invocation": "saved donor default"
            )

            if harness != "codex" {
                if model != "" {
                    args.Values["--model"] = model
                }
                if effort != "" {
                    args.Values["--effort"] = effort
                }
                return switch harness {
                    case "claude": ClaudeHarness.Select(args, policy, source)
                    case "pi": PiHarness.Select(args, policy, source)
                    case "omp": OmpHarness.Select(args, policy, source)
                    default: throw Exception("Unsupported managed harness/provider")
                }
            }

            let capabilities = CodexRuntime.Capabilities(args.Get("harness-path"))
            var availability = args.Get("availability", "unknown")
            let unavailable = availability == "unavailable" ? model: ""
            let choices = SortedDictionary[string, JsonElement](StringComparer.Ordinal)

            for entry in capabilities {
                if entry.Key == unavailable {
                    continue
                }

                for candidateEffort in entry.Value {
                    if policy.Allows("codex", "openai", entry.Key, candidateEffort) {
                        choices[entry.Key + " / " + candidateEffort] = J.Parse(
                            J.Write(map[string, Object?]{"model": entry.Key, "effort": candidateEffort})
                        )
                    }
                }
            }

            if choices.Count == 0 {
                throw Exception(
                    "No eligible pair: the intersection of exact owner policy and offline harness capabilities is empty after excluding donor-reported unavailable models. Other model availability is unknown. No inference started."
                )
            }

            if !choices.ContainsKey(model + " / " + effort) {
                var rejection = "Incomplete donor model/effort choice."
                if model != "" && effort != "" {
                    var supported HashSet[string]

                    try {
                        policy.Validate("codex", provider, model, effort, 1)
                        rejection = !capabilities.TryGetValue(model, out supported) || !supported.Contains(effort) ?
                        "Model/effort capability is not advertised by the offline native Codex catalog; availability is unknown.":
                        "Model is donor-reported unavailable."
                    } catch (error Exception) {
                        rejection = error.Message
                    }
                }

                let guidance = " Explicit donor choice required: --model MODEL --effort EFFORT. Eligible pairs: " +
                    String.Join(", ", choices.Keys) + ". No inference started."
                if (explicitPair || args.Get("profile") != "") && model != "" && effort != "" {
                    throw Exception(rejection + guidance)
                }

                if saved.ValueKind != JsonValueKind.Undefined {
                    reason = compatible ? "Saved default rejected: " + rejection:
                    "Saved default harness/provider does not match the selected codex/openai harness."
                }

                if !Interactive(args) {
                    throw Exception(reason + guidance)
                }

                Terminal.Message(reason + " Choose an eligible pair (availability unknown):", "yellow", true)

                let eligible = List[JsonElement](choices.Values)
                var selected int32

                try {
                    selected = ModelChecklist.Pick(
                        List[string](choices.Keys).ToArray(),
                        help: "Choose a model and effort allowed by the project and supported by your tool. Availability is not checked before you start."
                    )
                } catch (error OperationCanceledException) {
                    throw Exception("Explicit donor choice was not supplied. No inference started.")
                }

                model = J.Text(eligible[selected], "model")
                effort = J.Text(eligible[selected], "effort")
                source = "interactive donor choice"
                availability = "unknown"
            }

            args.Values["--model"] = model
            args.Values["--effort"] = effort
            let selected = Selection(args, policy, source)
            selected[
                "capability"
            ] = "compatible: native Codex explicit controls and offline bundled model/effort catalog"
            selected["availability"] = availability == "unknown" ? "unknown": "donor-reported " + availability
            selected[
                "availability_evidence"
            ] = "No account availability probe; catalog presence, PATH and login do not prove availability"
            return J.Parse(J.Write(selected))
        }

        internal func Selection(args Args, policy Policy, source string) Dictionary[string, Object?] {
            policy.Validate(args.Need("harness"), args.Need("provider"), args.Need("model"), args.Need("effort"), 1)
            if args.Get("availability") == "unavailable" {
                throw ExecutionFailure.Create(
                    "invalid_state",
                    "Selected model is donor-reported unavailable; no retry or fallback"
                )
            }
            return map[string, Object?]{
                "harness": args.Need("harness"),
                "provider": args.Need("provider"),
                "model": args.Need("model"),
                "effort": args.Need("effort"),
                "source": source,
                "policy_hash": policy.Digest,
                "policy_eligible": true
            }
        }

        internal func Confirm(args Args, selection JsonElement) {
            if args.Guided && args.Get("yes") != "true" {
                Terminal.Heading(args.Command == "claim" ? "Confirm reservation request": "Confirm donation")
                Terminal.Row("Task", args.Need("repo") + " #" + args.Need("issue"))
                Terminal.Row("Tool", J.Text(selection, "harness") + " / " + J.Text(selection, "provider"))
                Terminal.Row("Model", J.Text(selection, "model") + " / " + J.Text(selection, "effort"))
                Terminal.Row(
                    "Budget",
                    (
                        args.Get("unlimited") == "true" ? "Unlimited coding; ": args.Need("seconds") +
                            " seconds total; "
                    ) +
                        args.Get("verification-reserve", "0") + " reserved for verification"
                )
                Terminal.Row("Configuration", "Your configured tools and subagents remain enabled")
                Terminal.Row("Availability", J.Text(selection, "availability"))

                if WizardScreen.Choose(
                    "Confirm donation",
                    args.Command == "claim" ? "Post this claim without inference?": "Post this claim and start this donation when accepted?",
                    []string{"Post", "Cancel"},
                    "Post the reservation request without running the tool, or cancel. A donation starts only after the owner accepts it.",
                    selected: 2
                ) != 1 {
                    throw Exception("Donation was not confirmed. No claim or inference was started.")
                }

                if args.Command == "work" {
                    args.Values["--yes"] = "true"
                }

                return
            }

            let source = J.Text(selection, "source")

            if args.Get("yes") == "true" ||
                source == "explicit invocation" ||
                source == "saved donor default" ||
                source.StartsWith("saved donor profile ") {
                return
            }

            let pair = J.Text(selection, "model") + " / " + J.Text(selection, "effort")

            if !Interactive(args) {
                throw Exception(
                    "Inference confirmation required for " + pair + ": pass --yes explicitly. No inference started."
                )
            }

            if WizardScreen.Choose(
                "Confirm inference",
                "Use your allowance with " + J.Text(selection, "harness") + "/" + J.Text(selection, "provider") +
                    ": " +
                    pair +
                    " (" +
                    J.Text(selection, "availability") + ")?",
                []string{"Use", "Cancel"},
                "Choose Use to run the selected model with your configured account or local server. Choose Cancel to start nothing.",
                selected: 2
            ) != 1 {
                throw Exception("Inference was not confirmed. No inference started.")
            }

            args.Values["--yes"] = "true"
        }

        internal func Revalidate(run Data, policy Policy) {
            let selected = J.Get(run.Element(), "selection")

            if selected.ValueKind != JsonValueKind.Object {
                throw Exception("Managed runs require saved selection metadata; start a fresh claim")
            }

            let harness = J.Text(selected, "harness")
            let provider = J.Text(selected, "provider")
            let failure = "Saved selection differs from run or policy; no model substitution is allowed"
            for key in[]string{"harness", "provider", "model", "effort"} {
                if J.Text(selected, key) != run.Text(key) {
                    throw Exception(failure)
                }
            }

            if run.Number("version") != 2 || J.Text(selected, "policy_hash") != policy.Digest {
                throw Exception(failure)
            }

            policy.Validate(harness, provider, run.Text("model"), run.Text("effort"), run.Number("seconds"))
            switch harness {
                case "claude" {
                    ClaudeHarness.ValidateSaved(run)
                }
                case "pi" {
                    PiHarness.ValidateSaved(run)
                }
                case "omp" {
                    OmpHarness.ValidateSaved(run)
                }
            }
            if harness != "codex" {
                return
            }

            let capabilities = CodexRuntime.Capabilities(run.Text("harness_path"))
            var supported HashSet[string]

            if !capabilities.TryGetValue(run.Text("model"), out supported) || !supported.Contains(run.Text("effort")) {
                throw Exception("Saved model/effort is no longer compatible with native Codex. No retry or fallback.")
            }

            if J.Text(selected, "availability") == "donor-reported unavailable" {
                throw Exception("Selected model is donor-reported unavailable. No retry or fallback.")
            }
        }
    }
}
