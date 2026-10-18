package Tokate

import System
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
                (args.Command != "defaults" && args.Command != "claim" && args.Command != "work") {
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

            DonorDefaults.Fill(args, saved)
            DonorDefaults.CheckPaths(args, saved)
        }

        internal func Confirm(args Args, selection JsonElement, run Data? = nil) {
            if args.Get("yes") == "true" {
                return
            }

            let reserve = args.Get("verification-reserve", (run?.VerificationReserve ?? 0).ToString())
            Terminal.Message(
                (args.Get("feedback") == "true" ? "PR: " + (run?.PrUrl ?? "") + "\n": "") + "Task: " + args.Get(
                    "repo",
                    run?.Repo ?? ""
                ) +
                    " #" +
                    args.Get("issue", (run?.Issue ?? 0).ToString()) + "\nTool: " + J.Text(selection, "harness") +
                    " / " +
                    J.Text(selection, "provider") + "\nModel: " + J.Text(selection, "model") + "\nEffort: " + J.Text(
                    selection,
                    "effort"
                ) +
                    "\nBudget: " +
                    (
                    args.Get("unlimited") == "true" || run?.Unlimited == true ? "Unlimited coding":
                    args.Get("seconds", (run?.Seconds ?? 0).ToString()) + " seconds total"
                ) +
                    "; " +
                    (
                    reserve == "0" ? "no verification reserve, verification gets only the time coding leaves":
                    reserve + " seconds reserved for verification"
                ) +
                    (J.Text(selection, "harness") == "command" ? "\nCommand: " + CommandHarness.Text(selection): ""),
                error: true
            )
            let posting = run?.State == "claim_pending"
            let question = args.Command != "claim" ? "Start this donation?":
            posting ? "Post this claim?": "Prepare this attempt?"
            if !OwnerSetup.Confirm(args, question) {
                throw CliFailure("confirmation_required", "Donation requires --yes. No claim or inference started.")
            }
            args.Values["--yes"] = "true"
        }
    }
}
