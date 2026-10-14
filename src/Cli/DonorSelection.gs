package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class DonorSelection {
    shared {
        internal func Supported(value JsonElement) bool -> Managed(value) && J.Text(value, "provider") != ""

        internal func Managed(saved JsonElement) bool -> Harness.Accepts(
            J.Text(saved, "harness"),
            J.Text(saved, "provider")
        )

        internal func ApplyDefaults(args Args) {
            if args.Get("run") != "" || args.Get("source") == "external" ||
                (args.Command != "select" && args.Command != "claim" && args.Command != "work") {
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

            if (Harness.Find(harness)?.Provider == "" || harness == "command") && args.Get("provider") == "" {
                let allowed = policy.Providers(harness)
                let name = Harness.Find(harness)?.Title ?? "the command harness"

                if allowed.Count != 1 {
                    throw CliFailure(
                        "invalid_arguments",
                        "Choose --provider for " +
                            name +
                            ": the owner policy allows " +
                            (allowed.Count == 0 ? "no " + name + " provider": String.Join(", ", allowed)) +
                            ". No inference started."
                    )
                }

                args.Values["--provider"] = allowed[0]
            }

            let provider = args.Get("provider", "openai")

            if !Harness.Owns(harness, "claude-profile") && (args.Get("claude-profile") != "") {
                throw Exception("Claude profile options require the claude harness")
            }

            if !Harness.Owns(harness, "endpoint") &&
                (args.Get("endpoint") != "" || args.Get("pi-root") != "" || args.Get("node") != "") {
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

            let adapter = policy.Adapter(harness, args.Get("provider")) ??
                throw Exception("Unsupported managed harness/provider")
            if let choose = adapter.Select {
                if model != "" {
                    args.Values["--model"] = model
                }
                if effort != "" {
                    args.Values["--effort"] = effort
                }
                return choose(args, policy, source)
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

                throw CliFailure("invalid_arguments", reason + guidance)
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

        internal func Confirm(args Args, selection JsonElement, run Data? = nil) {
            if args.Get("yes") != "true" && !PublicOutput.Enabled && args.Get("json") != "true" && args.Get(
                "non-interactive"
            ) != "true" &&
                !Console.IsInputRedirected &&
                !Console.IsOutputRedirected &&
                !Console
                .IsErrorRedirected {
                Terminal.Message(
                    "Task: " + args.Get("repo", run?.Text("repo") ?? "") + " #" + args.Get(
                        "issue",
                        (run?.Number("issue") ?? 0).ToString()
                    ) +
                        "\nTool: " +
                        J.Text(selection, "harness") + " / " + J.Text(selection, "provider") + "\nModel: " + J.Text(
                        selection,
                        "model"
                    ) +
                        "\nEffort: " +
                        J.Text(selection, "effort") +
                        "\nBudget: " +
                        (
                        args.Get("unlimited") == "true" || run?.Flag("unlimited") == true ? "Unlimited coding":
                        args.Get("seconds", (run?.Number("seconds") ?? 0).ToString()) + " seconds total"
                    ) +
                        "; " +
                        args.Get("verification-reserve", (run?.Number("verification_reserve") ?? 0).ToString()) +
                        " seconds reserved for verification" +
                        (
                        J.Text(selection, "harness") == "command" ? "\nCommand: " + CommandHarness.Text(selection): ""
                    ),
                    error: true
                )
                let posting = run?.Text("state") == "claim_pending"
                let question = args.Command != "claim" ? "Start this donation?":
                posting ? "Post this claim?": "Prepare this attempt?"
                if !OwnerSetup.Confirm(args, question) {
                    throw CliFailure("confirmation_required", "Donation requires --yes. No claim or inference started.")
                }
                args.Values["--yes"] = "true"
                return
            }

            let source = (run?.Text("continuation_source") ?? "") == "" ? J.Text(selection, "source"):
            "explicit continuation import"

            if args.Get("yes") == "true" ||
                source == "explicit invocation" ||
                source == "saved donor default" ||
                source.StartsWith("saved donor profile ") {
                return
            }

            let pair = J.Text(selection, "model") + " / " + J.Text(selection, "effort")

            throw CliFailure(
                "confirmation_required",
                "Inference confirmation required for " + pair + ": pass --yes explicitly. No inference started."
            )
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
            let adapter = policy.Adapter(harness, provider)
            if let validate = adapter?.ValidateSaved {
                validate(run)
            }
            if adapter?.Select != nil {
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
