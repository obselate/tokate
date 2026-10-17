package Tokate

import Microsoft.Win32.SafeHandles
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Text.Json

internal class ExternalContribution {
    shared {
        private func Exists(path string) bool -> File.Exists(path) || Directory.Exists(path) || FileInfo(
            path
        ).LinkTarget != nil

        private func Unpublished(directory string, run Data) {
            if run.Pr != 0 || run.HasPublicationUuid || run.HasPublicationExpected || run.HasCorrection {
                throw ExecutionFailure.Create(
                    "invalid_state",
                    "External verification cannot replace publication intent"
                )
            }

            for name in[]string{"request.json", "request.json.posting.json", "publication.json"} {
                if Exists(Path.Combine(directory, name)) {
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "External verification cannot replace publication intent"
                    )
                }
            }

            let state = CoordinationState.Load(run.Repo, run.Issue)
            if J.Get(state.Value(), "contribution").ValueKind != JsonValueKind.Null || Publication.Pulls(run)
                .Count != 0 {
                throw ExecutionFailure.Create("invalid_state", "External contribution already has publication evidence")
            }
        }

        private func Failed(directory string, run Data, policy JsonElement) {
            let failure = "External correction requires a recorded independent verification failure"
            let descriptor = EvidenceOpen(Path.Combine(directory, "verification.json"), 131072 | 2048 | 524288)
            if descriptor < 0 {
                throw ExecutionFailure.Create("invalid_state", failure)
            }

            using let handle = SafeFileHandle(IntPtr(descriptor), true)
            using let file = FileStream(handle, FileAccess.Read)
            if !file.CanSeek {
                throw ExecutionFailure.Create("invalid_state", failure)
            }

            using let reader = StreamReader(file)
            let recorded = run.Verification
            let checks = J.Items(recorded)
            let commands = J.Items(Policy.Parse(policy).Verification)

            if run.FailureStage != "owner_verification" ||
                run.FailureReason != "verification_failed" ||
                checks.Count == 0 ||
                checks.Count > commands.Count ||
                !RequestData.Same(recorded, J.Parse(reader.ReadToEnd())) {
                throw ExecutionFailure.Create("invalid_state", failure)
            }

            for index in 0 ... checks.Count {
                let check = Verification.Result.Parse(checks[index])
                if !RequestData.Same(check.Command, commands[index]) {
                    throw ExecutionFailure.Create("invalid_state", failure)
                }

                let state = check.State
                let code = check.ExitCode
                if state == "completed" && code == 0 {
                    continue
                }

                if index == checks.Count - 1 &&
                    (
                    (state == "completed" && code != nil && code != 0) ||
                        ((state == "failed" || state == "interrupted") && code == nil && (check.Failure ?? "") != "")
                ) {
                    return
                }

                throw ExecutionFailure.Create("invalid_state", failure)
            }

            if checks.Count == commands.Count || run.Error != "Verification budget exhausted" {
                throw ExecutionFailure.Create("invalid_state", failure)
            }
        }

        private func KeepTools(previous JsonElement, current JsonElement) {
            let before = J.Items(previous)
            let after = J.Items(current)
            if after.Count < before.Count {
                throw ExecutionFailure.Create(
                    "invalid_state",
                    "Full external tools must retain every prior declaration"
                )
            }

            for index in 0 ... before.Count {
                if !RequestData.Same(before[index], after[index]) {
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "Full external tools must retain prior declarations before correction tools"
                    )
                }
            }
        }

        private func History(directory string, run Data, commit string) string {
            let previous = RepositoryIdentity.CommitSha(run.Commit)
            if commit != "" && commit == previous {
                throw ExecutionFailure.Create(
                    "invalid_state",
                    "External verification requires a new, never-attempted commit"
                )
            }

            let root = Path.Combine(directory, "external-history")
            let recorded = run.ExternalHistory
            if recorded.ValueKind != JsonValueKind.Undefined && recorded.ValueKind != JsonValueKind.Array {
                throw ExecutionFailure.Create("invalid_state", "External verification history is invalid")
            }

            let heads = HashSet[string](StringComparer.Ordinal)

            for head in J.Items(recorded) {
                if !heads.Add(RepositoryIdentity.CommitSha(head.GetString() ?? "")) {
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "External verification history contains duplicate attempts"
                    )
                }
            }

            if Exists(root) {
                LocalPaths.DirectoryPath(root)

                for entry in Directory.EnumerateFileSystemEntries(root) {
                    let head = RepositoryIdentity.CommitSha(Path.GetFileName(entry))
                    if head == commit || head == previous || !heads.Remove(head) {
                        throw ExecutionFailure.Create(
                            "invalid_state",
                            "External verification head was already attempted or its history is incomplete"
                        )
                    }

                    let checkout = Path.Combine(entry, "checkout")
                    Verification.Candidate(checkout)
                    if Commands.Git(checkout, "rev-parse", "HEAD") != head {
                        throw ExecutionFailure.Create("invalid_state", "Preserved external checkout changed")
                    }

                    let saved = OriginalEvidence.Load(entry)
                    if saved.Commit != head || saved.State != "failed" || saved.FailureStage != "owner_verification" {
                        throw ExecutionFailure.Create("invalid_state", "External verification history is incomplete")
                    }

                    for key in[]string{
                        "version",
                        "id",
                        "repo",
                        "issue",
                        "donor",
                        "donor_id",
                        "head_repo",
                        "approval",
                        "state_sha",
                        "attempt",
                        "base",
                        "base_branch",
                        "policy_hash",
                        "branch",
                        "seconds",
                        "source"
                    } {
                        if !RequestData.Same(J.Get(saved.Element(), key), J.Get(run.Element(), key)) {
                            throw ExecutionFailure.Create(
                                "stale_approval",
                                "Preserved external authority changed: " + key
                            )
                        }
                    }

                    KeepTools(saved.Tools, run.Tools)
                }
            }

            if heads.Count != 0 {
                throw ExecutionFailure.Create("invalid_state", "External verification history is missing")
            }

            return Path.Combine(root, previous)
        }

        private func Preserve(directory string, target string) {
            let root = Path.GetDirectoryName(target) ?? throw ExecutionFailure.Create(
                "invalid_state",
                "Missing external history directory"
            )

            Directory.CreateDirectory(root, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute)
            LocalPaths.DirectoryPath(root)

            let temporary = target + ".tmp"
            if Exists(temporary) || Exists(target) {
                throw ExecutionFailure.Create("invalid_state", "External verification history is incomplete")
            }

            Directory.CreateDirectory(
                temporary,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
            )
            LocalPaths.DirectoryPath(temporary)

            let archive = Path.Combine(temporary, "original-evidence")
            Directory.CreateDirectory(
                archive,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
            )
            LocalPaths.DirectoryPath(archive)

            for name in[]string{"run.json", "verification.json", "checks.json"} {
                let source = Path.Combine(directory, name)
                if name != "checks.json" || Exists(source) {
                    OriginalEvidence.CopyFile(source, Path.Combine(archive, name))
                }
            }

            OriginalEvidence.VerificationArtifacts(directory, archive)
            OriginalEvidence.Seal(archive)
            Directory.Move(temporary, target)
        }

        private func PrepareCheckout(
            directory string,
            run Data,
            record JsonElement,
            args Args,
            commit string,
            retry bool
        ) ValueTuple[int32, string] {
            var seconds = run.Seconds
            var tools = run.Tools
            var history = ""

            if retry {
                Failed(directory, run, J.Get(record, "policy"))
                args.Need("seconds")
                seconds = args.Number("seconds")
                tools = RequestData.FileData(args.Need("tools"), 4096)
                RequestMetadata.Tools(tools)

                let policy = Policy(J.Write(J.Get(record, "policy")))
                policy.ValidateBudget(seconds)
                policy.ValidateTools(tools, "external")
                KeepTools(run.Tools, tools)

                if J.Count(tools) == J.Count(run.Tools) {
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "External correction must append at least one tool declaration"
                    )
                }

                Unpublished(directory, run)
                history = History(directory, run, commit)
            }

            RepositoryAccess.ValidateFork(run.Repo, run.HeadRepo, run.Branch, commit, run.DonorId)

            let checkout = Path.Combine(directory, "checkout")
            if retry {
                Verification.Candidate(checkout)
                if Commands.Git(checkout, "rev-parse", "HEAD") != run.Commit {
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "Failed external checkout differs from its recorded commit"
                    )
                }

                Preserve(directory, history)

                let heads = J.Items(run.ExternalHistory)
                heads.Add(J.Parse(J.Write(run.Commit)))
                run.ExternalHistory = J.Parse(J.Write(heads))
                run.Commit = commit
                run.VerificationSeconds = seconds
                run.Tools = tools
                run.Transition("verifying")
                run.FailureStage = "candidate_validation"
                run.FailureReason = "candidate_invalid"
                run.Verification = J.Parse("[]")

                run.ClearPublicSummary()
                run.ClearVerificationProvenance()
                run.ClearToolProvenance()
                run.ClearError()

                run.Save(directory)

                Directory.Move(checkout, Path.Combine(history, "checkout"))
            } else if Exists(checkout) {
                throw ExecutionFailure.Create(
                    "invalid_state",
                    "External checkout already exists; interrupted verification requires inspection"
                )
            }

            return (seconds, checkout)
        }

        private func VerifyExternal(
            directory string,
            run Data,
            record JsonElement,
            checkout string,
            commit string,
            seconds int32,
            retry bool
        ) {
            let timer = Stopwatch.StartNew()
            run.Transition("verifying")
            run.Save(directory)

            let results = List[Object]()
            run.Verification = J.Parse(J.Write(results))
            Output.Sink.FailureCode = "verification_failed"
            run.FailureStage = "owner_verification"
            run.FailureReason = "verification_failed"

            run.Save(directory)

            File.WriteAllText(Path.Combine(directory, "verification.json"), J.Write(results))

            try {
                let budget = RuntimeBudget(timer, seconds)

                {
                    using let workspace = VerificationWorkspace.Create(checkout, budget)

                    for command in J.Items(Policy.Parse(J.Get(record, "policy")).Verification) {
                        let remaining = seconds - Convert.ToInt32(timer.Elapsed.TotalSeconds)
                        if remaining < 1 {
                            throw ExecutionFailure.Create("verification_failed", "Verification budget exhausted")
                        }

                        let result = Verification.Verify(
                            directory,
                            results,
                            command,
                            checkout,
                            remaining,
                            budget: budget,
                            workspace: workspace
                        )
                        if result.Code != 0 {
                            throw CliFailure(
                                "verification_failed",
                                "Independent external verification failed; no publication authority granted"
                            )
                        }
                    }

                    Output.Sink.FailureCode = "invalid_state"
                    run.FailureStage = "changed_candidate"
                    run.FailureReason = "candidate_changed"
                    workspace.Unchanged(budget)
                }

                Output.Sink.FailureCode = "invalid_state"
                run.FailureStage = "changed_candidate"
                run.FailureReason = "candidate_changed"
                Verification.Candidate(checkout)

                if Commands.Git(checkout, "rev-parse", "HEAD") != commit || Commands.Git(
                    checkout,
                    "status",
                    "--porcelain"
                ) != "" {
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "Independent verification changed the declared commit or checkout"
                    )
                }

                ContributionAuthority.Recheck(run)

                if retry {
                    RepositoryAccess.ValidateFork(run.Repo, run.HeadRepo, run.Branch, commit, run.DonorId)
                    Unpublished(directory, run)
                    History(directory, run, "")
                }

                run.Verification = J.Parse(J.Write(results))
                run.VerificationProvenance = "tokate-observed locally, exact commit " + commit
                run.ToolProvenance = "donor-reported; identity, usage and coding time not independently attested"
                run.Transition("generated")
                run.ClearFailureStage()
                run.ClearFailureReason()

                run.Save(directory)
            } catch (error Exception) when error is CliFailure ||
                error is CommandInterrupted ||
                error is ApiDeadlineException ||
                error.GetType() == typeof(Exception) ||
                error is IOException ||
                error is UnauthorizedAccessException ||
                error is JsonException {
                run.Transition("failed")
                run.Error = error.Message
                run.Verification = J.Parse(J.Write(results))

                run.Save(directory)

                throw ExecutionFailure.From(error, Output.Sink.FailureCode)
            }
        }

        internal func External(args Args) {
            try {
                let directory = Path.GetFullPath(args.Need("run"))
                using let lease = RunStorage.Lease(directory)
                let run = Data.Load(directory)
                let retry = run.State == "failed"

                if run.Version != 2 || run.Source != "external" || (run.State != "claimed" && !retry) {
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "Expected unexecuted external work or a recorded external verification failure"
                    )
                }

                if !retry && (args.Get("seconds") != "" || args.Get("tools") != "") {
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "--time and --tools require a failed external verification"
                    )
                }

                let record = ContributionAuthority.Recheck(run)
                if args.Get("commit") == "" {
                    args.Values["--commit"] = Commands.Git(Path.Combine(directory, "coding"), "rev-parse", "HEAD")
                }

                let commit = RepositoryIdentity.CommitSha(args.Need("commit"))
                ContributionHandoff.Candidate(run.Handoff, run.HeadRepo, commit)
                let summary = PublicSummary.FileSummary(args.Get("summary"), commit)

                let prepared = PrepareCheckout(directory, run, record, args, commit, retry)
                let seconds = prepared.Item1
                let checkout = prepared.Item2

                if summary.ValueKind != JsonValueKind.Undefined {
                    run.PublicSummary = summary
                }

                Directory.CreateDirectory(checkout)
                Commands.Git(checkout, "init", "--quiet", "--template=")
                Commands.Git(
                    checkout,
                    "fetch",
                    "--quiet",
                    "--no-tags",
                    "--no-recurse-submodules",
                    "--",
                    "https://github.com/" + run.HeadRepo + ".git",
                    commit
                )
                Commands.Git(
                    checkout,
                    "fetch",
                    "--quiet",
                    "--no-tags",
                    "--no-recurse-submodules",
                    "--",
                    "https://github.com/" + run.Repo + ".git",
                    run.Base
                )
                Commands.Git(checkout, "checkout", "--quiet", "--detach", commit)
                Verification.Candidate(checkout)

                if Commands.Git(checkout, "rev-parse", "HEAD") != commit {
                    throw ExecutionFailure.Create("invalid_state", "Fetched commit differs from exact declaration")
                }

                Commands.Git(checkout, "merge-base", "--is-ancestor", run.Base, commit)
                run.Commit = commit

                try {
                    Commands.Git(checkout, "diff", "--check", run.Base, commit)
                    Contribution.CheckPaths(checkout, record, run, commit)
                } catch (error Exception) when error is CliFailure ||
                    error is CommandInterrupted ||
                    error.GetType() == typeof(Exception) ||
                    error is IOException ||
                    error is UnauthorizedAccessException {
                    run.Transition("failed")
                    run.Error = error.Message

                    run.Save(directory)

                    throw ExecutionFailure.From(error, Output.Sink.FailureCode)
                }

                VerifyExternal(directory, run, record, checkout, commit, seconds, retry)

                Output.Sink.Message(
                    "Exact external commit passed independent verification. Use " + Output.Sink.Command(
                        []string{"tokate", "submit", "--run", directory}
                    )
                )
            } catch (error Exception) when error is IOException ||
                error is UnauthorizedAccessException ||
                error is JsonException {
                throw ExecutionFailure.From(error, "command_failed")
            }
        }
    }
}
