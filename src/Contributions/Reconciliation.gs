package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class Reconciliation {
    shared {
        private func Published(run Data, pending string = "") JsonElement {
            if run.Number("version") != 2 || (run.Text("state") != "generated" && run.Text("state") != "published") {
                throw CliFailure("invalid_state", "Reconcile requires a published current contribution")
            }

            let old = J.Get(run.Element(), "reconciliation")
            let synchronization = pending != "" ? pending:
            J.Text(old, "candidate") != run.Text("commit") ? J.Text(old, "pending"): ""
            let grant = synchronization == "" ? default(JsonElement): Synchronization.Load(
                run.Text("repo"),
                synchronization
            )
            let published = J.Text(grant, "previous") == run.Text("commit") ? J.Text(grant, "candidate"): run.Text(
                "commit"
            )
            let authority = Amendment.Authority(run, nil, published: published)
            let record = J.Get(authority, "record")
            let pr = J.Number(J.Get(CoordinationState.Current(J.Get(authority, "state")), "outcome"), "pr")

            if pr < 1 {
                throw CliFailure("invalid_state", "No published PR; inspect saved publication before reconciling.")
            }

            let pull = Amendment.Pull(run, pr, published, "")
            Amendment.Remote(run, published, "")

            ReceiptVerification.Verify(run.Text("repo"), pr, pull, false, pending: synchronization)

            let receipt = PrBody.Receipt(J.Text(pull, "body"))
            let upstream = GitHub.Branch(run.Text("repo"), run.Text("base_branch"))

            return J.Parse(
                J.Write(
                    map[string, Object?]{
                        "record": record,
                        "pr": pr,
                        "receipt": receipt,
                        "upstream": upstream,
                        "expected": J.Text(authority, "sha")
                    }
                )
            )
        }

        private func Fresh(run Data, intent JsonElement, moved bool = false, pending string = "") JsonElement {
            let live = Published(run, pending)

            if run.Text("commit") != J.Text(intent, "previous") || run.Text("approval") != J.Text(intent, "approval") ||
                run.Text("base") != J.Text(intent, "base") || run.Text("base_branch") != J.Text(intent, "target") ||
                (!moved && J.Text(live, "upstream") != J.Text(intent, "upstream")) ||
                J.Text(live, "expected") != J.Text(intent, "expected") || J.Number(live, "pr") != J.Number(
                intent,
                "pr"
            ) ||
                !RequestData
                .Same(J.Get(live, "receipt"), J.Get(intent, "receipt")) {
                throw CliFailure(
                    "invalid_state",
                    "Published head, target or approval changed; preserve this workspace and ask the owner to review the saved exact intent. No reset or retarget was performed."
                )
            }

            return J.Get(live, "record")
        }

        private func Head(checkout string) string -> RepositoryIdentity.CommitSha(
            Commands.Git(checkout, "rev-parse", "HEAD")
        )

        private func HeadRef(checkout string) string -> Commands.Git(
            checkout,
            "rev-parse",
            "--symbolic-full-name",
            "HEAD"
        )

        private func Clean(checkout string) {
            if Commands.Git(
                checkout,
                "--no-optional-locks",
                "status",
                "--porcelain",
                "--untracked-files=all",
                "--ignore-submodules=none"
            ) != "" {
                throw CliFailure(
                    "invalid_state",
                    "Dirty workspace preserved; inspect and commit or move your changes explicitly, then reconcile. No files were replaced."
                )
            }
        }

        private func Operations(checkout string, intent JsonElement, resume bool) {
            let git = Path.Combine(checkout, ".git")

            for name in[]string{
                "CHERRY_PICK_HEAD",
                "REVERT_HEAD",
                "REBASE_HEAD",
                "rebase-merge",
                "rebase-apply",
                "sequencer",
                "BISECT_START",
                "index.lock",
                "HEAD.lock",
                "MERGE_AUTOSTASH"
            } {
                if File.Exists(Path.Combine(git, name)) || Directory.Exists(Path.Combine(git, name)) {
                    throw CliFailure(
                        "invalid_state",
                        "Unrelated or active Git operation preserved; inspect and finish that operation explicitly before reconcile: " +
                            name
                    )
                }
            }

            let merge = Path.Combine(git, "MERGE_HEAD")

            if !File.Exists(merge) {
                return
            }

            if !resume || J.Text(intent, "phase") != "merging" || File.ReadAllText(merge).Trim() != J.Text(
                intent,
                "upstream"
            ) ||
                Head(checkout) != J.Text(intent, "start") || Commands.Git(checkout, "rev-parse", "ORIG_HEAD") != J.Text(
                intent,
                "start"
            ) {
                throw CliFailure(
                    "invalid_state",
                    "Unidentified merge preserved; inspect its physical Git state and use its original operation intent. No merge was repeated."
                )
            }

            throw CliFailure(
                "invalid_state",
                "Saved merge is unfinished; resolve conflicts in the saved checkout, stage and commit the resolution, then use reconcile --run DIR --resume. Index and workspace preserved."
            )
        }

        private func Candidate(directory string, checkout string, run Data, intent JsonElement) {
            WorkspacePreparation.PublishedSource(checkout, run)
            Operations(checkout, intent, true)

            if HeadRef(checkout) != J.Text(intent, "head_ref") {
                throw CliFailure(
                    "invalid_state",
                    "Local branch identity changed; inspect the original saved checkout before resuming. Workspace preserved."
                )
            }

            Clean(checkout)
            let candidate = Head(checkout)

            if Commands.GitResult(
                checkout,
                []string{"merge-base", "--is-ancestor", run.Text("base"), J.Text(intent, "upstream")}
            )
                .Code != 0 {
                throw CliFailure(
                    "invalid_state",
                    "Saved target lacks approved-base ancestry; preserve the workspace and ask the owner to inspect that exact target."
                )
            }

            for ancestor in[]string{J.Text(intent, "previous"), J.Text(intent, "start"), J.Text(intent, "upstream")} {
                if Commands.GitResult(checkout, []string{"merge-base", "--is-ancestor", ancestor, candidate})
                    .Code != 0 {
                    throw CliFailure(
                        "invalid_state",
                        "No completed merge with saved H, starting head and U ancestry; inspect physical state, fetch and merge the saved exact U explicitly if needed, commit, then reconcile --run DIR --resume. No merge was repeated."
                    )
                }
            }

            if J.Text(intent, "phase") == "complete" && candidate != J.Text(intent, "candidate") {
                throw CliFailure(
                    "invalid_state",
                    "Completed local candidate changed; inspect the saved exact candidate before resuming."
                )
            }

            let record = Fresh(run, intent)

            ProtectedPaths.EqualTrees(
                J.Get(record, "policy"),
                J.Get(record, "approval"),
                GitHubPathEvidence.Tree(run.Text("repo"), J.Text(intent, "upstream")),
                ProtectedPaths.LocalTree(checkout, candidate)
            )

            Fresh(run, intent)

            WorkspacePreparation.PublishedSource(checkout, run)
            Operations(checkout, intent, true)
            Clean(checkout)

            if Head(checkout) != candidate || HeadRef(checkout) != J.Text(intent, "head_ref") {
                throw CliFailure(
                    "invalid_state",
                    "Local candidate changed during inspection; preserve and inspect before resume."
                )
            }

            let saved = Data.From(intent)
            saved.Fields["phase"] = "complete"
            saved.Fields["candidate"] = candidate
            run.Fields["reconciliation"] = saved.Element()

            run.Save(directory)

            PublicOutput.ResultData = map[string, Object?]{
                "candidate": candidate,
                "upstream": J.Text(intent, "upstream"),
                "previous": J.Text(intent, "previous"),
                "local": true,
                "verified": false
            }

            let authorization = List[string]{
                "tokate",
                "sync",
                run.Text("repo") + "#" + J.Number(intent, "pr").ToString(),
                "authorize",
                "--commit",
                candidate,
                "--upstream",
                J.Text(intent, "upstream")
            }

            if J.Text(intent, "pending") != "" {
                authorization.AddRange([]string{"--sync", J.Text(intent, "pending")})
            }

            PublicOutput.Actions.Add(authorization.ToArray())

            Terminal.Message(
                "Local, unverified candidate C: " + candidate + "; target U: " + J.Text(intent, "upstream") +
                    ". Owner: sync PR authorize for exact C/U" +
                    (J.Text(intent, "pending") == "" ? "": " with --sync " + J.Text(intent, "pending")) +
                    ", then donor: amend --run DIR --commit C --sync G --time TIME for independent verification and publication."
            )
        }

        internal func Run(args Args) {
            let directory = Path.GetFullPath(args.Need("run"))
            PublicOutput.RunDirectory = directory
            using let lease = RunStorage.Lease(directory)
            let run = Data.Load(directory)
            let checkout = Path.Combine(directory, "checkout")
            WorkspacePreparation.PublishedSource(checkout, run)

            let old = J.Get(run.Element(), "reconciliation")

            if args.Get("resume") == "true" {
                if old.ValueKind != JsonValueKind.Object {
                    throw CliFailure(
                        "invalid_state",
                        "No saved reconciliation intent; inspect status, then reconcile --run DIR without --resume."
                    )
                }

                Fresh(run, old)
                Candidate(directory, checkout, run, old)
                return
            }

            if old.ValueKind != JsonValueKind.Undefined && J.Text(old, "phase") != "complete" {
                throw CliFailure(
                    "invalid_state",
                    "Saved reconciliation retained; use reconcile --run DIR --resume. Obtain owner authorization and amend the exact completed candidate before starting another reconciliation."
                )
            }

            Operations(checkout, default(JsonElement), false)
            Clean(checkout)

            var pending = J.Text(old, "candidate") == run.Text("commit") ? "": J.Text(old, "pending")
            var completed bool

            if old.ValueKind == JsonValueKind.Object && J.Text(old, "phase") == "complete" && J.Text(
                old,
                "upstream"
            ) != GitHub
                .Branch(run.Text("repo"), run.Text("base_branch")) {
                let location = Path.Combine(
                    directory,
                    "amendments",
                    RepositoryIdentity.CommitSha(J.Text(old, "candidate"))
                )
                if Directory.Exists(location) {
                    let amendment = Data.Load(location)
                    OriginalEvidence.Amended(directory, run, amendment)

                    if amendment.Text("commit") == J.Text(old, "candidate") && amendment.Text("previous") == run.Text(
                        "commit"
                    ) &&
                        amendment.Text("expected") == J.Text(old, "expected") && Amendment.Remote(
                        run,
                        amendment.Text("published") == "" ? run.Text("commit"): amendment.Text("published"),
                        J.Text(old, "candidate")
                    ) == J
                        .Text(old, "candidate") {
                        if Head(checkout) != J.Text(old, "candidate") || HeadRef(checkout) != J.Text(old, "head_ref") {
                            throw CliFailure("invalid_state", "Saved reconciliation candidate or local branch changed")
                        }

                        let authority = Amendment.Authority(run, amendment, ready: false)
                        if CoordinationState.Head(J.Get(authority, "state")) == amendment.Text("commit") {
                            let pull = Amendment.Pull(run, amendment.Number("pr"), amendment.Text("commit"), "")
                            ReceiptVerification.Verify(run.Text("repo"), amendment.Number("pr"), pull, false)

                            Verification.Results(amendment, J.Get(authority, "record"))

                            Amendment.Complete(directory, location, run, amendment, pull)
                            pending = ""
                            completed = true
                        } else {
                            pending = amendment.Text("sync")
                        }
                    }
                }
            }

            let live = Published(run, pending)
            let moved = old.ValueKind == JsonValueKind.Object && J.Text(old, "phase") == "complete" && J.Text(
                old,
                "candidate"
            ) != run.Text("commit") && J.Text(old, "upstream") != J.Text(live, "upstream")

            if old.ValueKind != JsonValueKind.Undefined &&
                !moved &&
                (J.Text(old, "phase") != "complete" || J.Text(old, "candidate") != run.Text("commit")) {
                throw CliFailure(
                    "invalid_state",
                    "Saved reconciliation retained; use reconcile --run DIR --resume. Obtain owner authorization and amend the exact completed candidate before starting another reconciliation."
                )
            }

            if moved {
                Fresh(run, old, true, pending)

                if Head(checkout) != J.Text(old, "candidate") || HeadRef(checkout) != J.Text(old, "head_ref") {
                    throw CliFailure("invalid_state", "Saved reconciliation candidate or local branch changed")
                }
            }

            let start = Head(checkout)
            let headRef = HeadRef(checkout)

            if headRef != "HEAD" && headRef != "refs/heads/" + run.Text("branch") {
                throw CliFailure(
                    "invalid_state",
                    "Unidentified local branch preserved; return explicitly to the saved contribution branch or detached candidate before reconcile."
                )
            }

            if J.Get(run.Element(), "preparation_head_id").ToString() != J.Get(
                GitHub.Api("repos/" + run.Text("head_repo")),
                "id"
            )
                .ToString() {
                throw CliFailure(
                    "invalid_state",
                    "Saved fork identity changed; inspect the original fork before reconciliation."
                )
            }

            if Commands.GitResult(checkout, []string{"merge-base", "--is-ancestor", run.Text("commit"), start})
                .Code != 0 {
                throw CliFailure(
                    "invalid_state",
                    "Local head does not descend from published H; inspect committed work and use the original contribution checkout. No reset was performed."
                )
            }

            let intent = map[string, Object?]{
                "previous": run.Text("commit"),
                "upstream": J.Text(live, "upstream"),
                "start": start,
                "head_ref": headRef,
                "target": run.Text("base_branch"),
                "base": run.Text("base"),
                "approval": run.Text("approval"),
                "expected": J.Text(live, "expected"),
                "pr": J.Number(live, "pr"),
                "receipt": J.Get(live, "receipt"),
                "phase": "fetching"
            }

            if pending != "" {
                intent["pending"] = pending
            }

            if moved || completed {
                let superseded = Data.From(old)
                superseded.Fields.Remove("superseded")
                intent["superseded"] = superseded.Element()
            }

            run.Fields["reconciliation"] = intent
            run.Save(directory)

            let bound = J.Parse(J.Write(intent))

            Fresh(run, bound)

            Commands.Git(
                checkout,
                "fetch",
                "--quiet",
                "--no-tags",
                "--no-recurse-submodules",
                "--",
                "https://github.com/" + run.Text("repo") + ".git",
                J.Text(bound, "upstream")
            )

            Fresh(run, bound)

            WorkspacePreparation.PublishedSource(checkout, run)
            Operations(checkout, bound, false)
            Clean(checkout)

            if Head(checkout) != start || HeadRef(checkout) != J.Text(bound, "head_ref") {
                throw CliFailure(
                    "invalid_state",
                    "Local starting head changed before merge; inspect saved intent and resume explicitly. Workspace preserved."
                )
            }

            Commands.Git(checkout, "merge-base", "--is-ancestor", run.Text("base"), J.Text(bound, "upstream"))

            let preview = Commands.GitResult(
                checkout,
                []string{"merge-tree", "--write-tree", "--no-messages", start, J.Text(bound, "upstream")}
            )

            if preview.Code != 0 && preview.Code != 1 {
                throw CliFailure("invalid_state", "Cannot inspect the upstream merge; workspace preserved.")
            }

            let tree = RepositoryIdentity.CommitSha(preview.Output.Split('\n')[0])

            let ignored = Commands.GitRaw(
                checkout,
                []string{"ls-files", "--others", "--ignored", "--exclude-standard", "-z"}
            )
                .Split('\0', StringSplitOptions.RemoveEmptyEntries)

            for path in Commands.GitRaw(
                checkout,
                []string{"diff", "--name-only", "--no-renames", "--diff-filter=AMT", "-z", start, tree, "--"}
            )
                .Split('\0', StringSplitOptions.RemoveEmptyEntries) {
                for file in ignored {
                    if file == path || file.StartsWith(path + "/", StringComparison.Ordinal) || path.StartsWith(
                        file + "/",
                        StringComparison.Ordinal
                    ) {
                        throw CliFailure(
                            "invalid_state",
                            "Ignored path collision preserved: " + J.Write(file) +
                                ". Move it explicitly before merging the saved upstream. No files were replaced."
                        )
                    }
                }
            }

            intent["phase"] = "merging"
            run.Fields["reconciliation"] = intent
            run.Save(directory)

            let merged = Commands.GitResult(
                checkout,
                []string{
                    "-c",
                    "user.name=" + run.Text("donor"),
                    "-c",
                    "user.email=tokate@users.noreply.github.com",
                    "-c",
                    "commit.gpgsign=false",
                    "merge",
                    "--no-ff",
                    "--no-edit",
                    "--no-verify",
                    "--no-overwrite-ignore",
                    J.Text(bound, "upstream")
                }
            )

            if merged.Code != 0 {
                throw CliFailure(
                    "invalid_state",
                    "Merge stopped; inspect the saved checkout and index, resolve and commit conflicts if present, then reconcile --run DIR --resume. No reset or retry was performed."
                )
            }

            Candidate(directory, checkout, run, J.Parse(J.Write(intent)))
        }
    }
}
