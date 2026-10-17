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
            run.FailureStage = "candidate_validation"
            run.FailureReason = "candidate_invalid"

            if !run.Unlimited && seconds - reserve <= elapsed {
                throw ExecutionFailure.Create("command_failed", "Runtime allowance exhausted")
            }

            let coding = RuntimeBudget(timer, run.Unlimited ? 0: seconds - reserve - elapsed)
            var total = RuntimeBudget(timer, run.Unlimited ? 0: seconds - elapsed)
            var checkout string
            var candidate string

            {
                using let progress = Output.Sink.Progress("Candidate validation", coding, total)
                coding.Remaining()
                checkout = Verification.Candidate(Path.Combine(directory, "checkout"), coding)

                if run.Gratis && GratisOutcome.Collect(directory, checkout, run, coding) {
                    return
                }

                if coding.Git(checkout, "status", "--porcelain") == "" {
                    throw ExecutionFailure.Create("invalid_state", "No changes returned. No PR will be opened.")
                }

                run.FailureReason = "public_summary_invalid"

                try {
                    PublicSummary.Capture(directory, checkout, run)
                } catch (error Exception) when error is CliFailure ||
                    error is CommandInterrupted ||
                    error.GetType() == typeof(Exception) ||
                    error is IOException ||
                    error is UnauthorizedAccessException ||
                    error is JsonException {
                    run.ElapsedSeconds = elapsed + Convert.ToInt32(Math.Ceiling(timer.Elapsed.TotalSeconds))
                    throw error
                }

                run.FailureReason = "candidate_invalid"
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

            if !run.Gratis {
                Output.Sink.Step("Running independent owner verification...")
            }

            if run.Unlimited {
                total = RuntimeBudget(Stopwatch.StartNew(), reserve)
            }

            let verification = VerifyOwner(directory, run, record, checkout, seconds, total)

            run.Verification = J.Parse(J.Write(verification))
            Output.Sink.FailureCode = "invalid_state"
            run.FailureStage = "changed_candidate"
            run.FailureReason = "candidate_changed"

            using let progress = Output.Sink.Progress(
                run.Gratis ? "Candidate validation": "Verified candidate validation",
                total
            )
            let patch = Snapshot(checkout, run, total)

            CheckPaths(checkout, record, run, budget: total)

            if patch != candidate {
                throw ExecutionFailure.Create("invalid_state", "Verification changed the saved patch")
            }

            File.WriteAllText(Path.Combine(directory, "changes.patch"), patch)

            run.Usage = J.Parse(J.Write(usage))
            run.ElapsedSeconds = elapsed + Convert.ToInt32(timer.Elapsed.TotalSeconds)
            run.Transition("generated")
            run.ClearFailureReason()
            run.ClearFailureStage()

            run.Save(directory)
        }

        private func VerifyOwner(
            directory string,
            run Data,
            record JsonElement,
            checkout string,
            seconds int32,
            total RuntimeBudget
        ) List[Object] {
            Output.Sink.FailureCode = "verification_failed"
            run.FailureStage = "owner_verification"
            run.FailureReason = "verification_failed"
            let verification = List[Object]()
            run.Verification = J.Parse(J.Write(verification))

            run.Save(directory)

            File.WriteAllText(Path.Combine(directory, "verification.json"), J.Write(verification))

            try {
                if !run.Gratis {
                    using let workspace = VerificationWorkspace.Create(checkout, total)

                    for command in J.Items(Policy.Parse(J.Get(record, "policy")).Verification) {
                        total.Remaining()
                        run.Verification = J.Parse(J.Write(verification))
                        run.Save(directory)

                        let check = Verification.Verify(
                            directory,
                            verification,
                            command,
                            checkout,
                            seconds,
                            total,
                            workspace: workspace
                        )
                        if check.Code != 0 {
                            run.FailureReason = "verification_failed"
                            throw CliFailure(
                                "verification_failed",
                                "Owner verification failed. Inspect the private verification.json artifact before explicit recovery."
                            )
                        }
                    }

                    Output.Sink.FailureCode = "invalid_state"
                    run.FailureStage = "changed_candidate"
                    run.FailureReason = "candidate_changed"
                    workspace.Unchanged(total)
                }
            } finally {
                run.Verification = J.Parse(J.Write(verification))
            }

            return verification
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
                    run.Base,
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

            let patch = Commands.GitRaw(checkout, []string{"diff", "--cached", "--binary", run.Base}, budget)
            if patch == "" {
                throw ExecutionFailure.Create("invalid_state", "No changes returned. No PR will be opened.")
            }

            return patch
        }
    }
}
