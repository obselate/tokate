package Tokate

import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Text.Json

internal class Contribution {
    shared {
        internal func Finish(
            directory string,
            run Data,
            record JsonElement,
            usage Dictionary[string, Object?],
            timer Stopwatch,
            seconds int32,
            reserve int32 = 0,
            elapsed int32 = 0
        ) {
            run.Fields["failure_stage"] = "candidate_validation"
            run.Fields["failure_reason"] = "candidate_invalid"

            if !run.Flag("unlimited") && seconds - reserve <= elapsed {
                throw ExecutionFailure.Create("command_failed", "Runtime allowance exhausted")
            }

            let coding = RuntimeBudget(timer, run.Flag("unlimited") ? 0: seconds - reserve - elapsed)
            var total = RuntimeBudget(timer, run.Flag("unlimited") ? 0: seconds - elapsed)
            var checkout string
            var candidate string

            {
                using let progress = TerminalProgress("Candidate validation", coding, total)
                coding.Remaining()
                checkout = Verification.Candidate(Path.Combine(directory, "checkout"), coding)

                if run.Flag("gratis") && Gratis.Outcome(directory, checkout, run, coding) {
                    return
                }

                if coding.Git(checkout, "status", "--porcelain") == "" {
                    throw ExecutionFailure.Create("invalid_state", "No changes returned. No PR will be opened.")
                }

                run.Fields["failure_reason"] = "public_summary_invalid"

                try {
                    PublicSummary.Capture(directory, checkout, run)
                } catch (error Exception) when error is CliFailure ||
                    error is CommandInterrupted ||
                    error.GetType() == typeof(Exception) ||
                    error is IOException ||
                    error is UnauthorizedAccessException ||
                    error is JsonException {
                    run.Fields["elapsed_seconds"] = elapsed + Convert.ToInt32(Math.Ceiling(timer.Elapsed.TotalSeconds))
                    throw error
                }

                run.Fields["failure_reason"] = "candidate_invalid"
                candidate = Snapshot(checkout, run, coding)
                PublicSummary.Bind(run, candidate)
                run.Save(directory)

                let candidatePath = Path.Combine(directory, "candidate.patch")
                if !File.Exists(candidatePath) {
                    File.WriteAllText(candidatePath, candidate)
                }

                CheckPaths(checkout, record, run, budget: coding)

                if File.ReadAllText(candidatePath) != candidate {
                    throw ExecutionFailure.Create("invalid_state", "Saved candidate patch changed")
                }

                coding.Remaining()
            }

            Terminal.Step("Running independent owner verification...")

            if run.Flag("unlimited") {
                total = RuntimeBudget(Stopwatch.StartNew(), reserve)
            }

            PublicOutput.FailureCode = "verification_failed"
            run.Fields["failure_stage"] = "owner_verification"
            run.Fields["failure_reason"] = "verification_failed"
            let verification = List[Object]()
            run.Fields["verification"] = verification

            run.Save(directory)

            File.WriteAllText(Path.Combine(directory, "verification.json"), J.Write(verification))

            {
                if !run.Flag("gratis") {
                    using let workspace = VerificationWorkspace.Create(checkout, total)

                    for command in J.Items(J.Get(J.Get(record, "policy"), "verification")) {
                        total.Remaining()
                        run.Fields["verification"] = verification
                        run.Save(directory)

                        let check = Terminal.Verify(
                            directory,
                            verification,
                            command,
                            checkout,
                            seconds,
                            total,
                            workspace: workspace
                        )
                        if check.Code != 0 {
                            run.Fields["failure_reason"] = "verification_failed"
                            throw CliFailure(
                                "verification_failed",
                                "Owner verification failed. Inspect the private verification.json artifact before explicit recovery."
                            )
                        }
                    }

                    PublicOutput.FailureCode = "invalid_state"
                    run.Fields["failure_stage"] = "changed_candidate"
                    run.Fields["failure_reason"] = "candidate_changed"
                    workspace.Unchanged(total)
                }
            }

            run.Fields["verification"] = verification
            PublicOutput.FailureCode = "invalid_state"
            run.Fields["failure_stage"] = "changed_candidate"
            run.Fields["failure_reason"] = "candidate_changed"

            using let progress = TerminalProgress("Verified candidate validation", total)
            let patch = Snapshot(checkout, run, total)

            CheckPaths(checkout, record, run, budget: total)

            if patch != candidate {
                throw ExecutionFailure.Create("invalid_state", "Verification changed the saved patch")
            }

            File.WriteAllText(Path.Combine(directory, "changes.patch"), patch)

            run.Fields["usage"] = usage
            run.Fields["elapsed_seconds"] = elapsed + Convert.ToInt32(timer.Elapsed.TotalSeconds)
            run.Fields["state"] = "generated"
            run.Fields.Remove("failure_reason")
            run.Fields.Remove("failure_stage")

            run.Save(directory)
        }

        internal func CheckPaths(
            checkout string,
            record JsonElement,
            run Data,
            head string = "",
            budget RuntimeBudget? = nil
        ) {
            try {
                ProtectedPaths.Local(
                    checkout,
                    J.Get(record, "policy"),
                    J.Get(record, "approval"),
                    run.Text("base"),
                    head,
                    budget
                )
            } catch (error Exception) when error.GetType() == typeof(Exception) {
                throw ExecutionFailure.From(error, "invalid_state")
            }
        }

        internal func Snapshot(checkout string, run Data, budget RuntimeBudget) string {
            Verification.Candidate(checkout, budget)
            let head = budget.Git(checkout, "rev-parse", "HEAD")

            if head != ContributionHandoff.StartHead(run) {
                throw ExecutionFailure.Create("invalid_state", "Agent changed Git history")
            }

            budget.Git(checkout, "add", "-A")
            budget.Git(checkout, "diff", "--cached", "--check")

            let patch = Commands.GitRaw(checkout, []string{"diff", "--cached", "--binary", run.Text("base")}, budget)
            if patch == "" {
                throw ExecutionFailure.Create("invalid_state", "No changes returned. No PR will be opened.")
            }

            return patch
        }
    }
}
