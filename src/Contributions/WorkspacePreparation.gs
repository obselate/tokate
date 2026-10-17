package Tokate

import Gsharp.Concurrency
import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class WorkspacePreparation {
    shared {
        private const ForkDiscoveryTimeoutSeconds int32 = 60

        private const ForkDiscoveryPageCountLimit int32 = 3

        private const RemoteReadAttemptLimit int32 = 5

        private const RemoteReadDelaySeconds float64 = 1.0

        private func Identity(run Data) string -> J.Hash(
            J.Write(
                map[string, Object?]{
                    "version": run.Version,
                    "id": run.Id,
                    "repo": run.Repo.ToLowerInvariant(),
                    "issue": run.Issue,
                    "donor_id": run.DonorId,
                    "approval": run.Approval,
                    "state_sha": run.StateSha,
                    "base": run.Base,
                    "base_branch": run.BaseBranch,
                    "branch": run.Branch,
                    "source": run.Source,
                    "fork": run.RequestedFork.ToLowerInvariant(),
                    "head_repo": run.HeadRepo.ToLowerInvariant()
                }
            )
        )

        private func Identified(run Data) bool {
            let identity = run.PreparationIdentity
            return identity == BoundIdentity(run)
        }

        internal func CheckIdentity(run Data) {
            if run.PreparationVersion != 1 || !Identified(run) {
                throw CliFailure(
                    "invalid_state",
                    "Saved preparation identity changed; import provenance cannot be removed or rebound"
                )
            }
        }

        private func BoundIdentity(run Data) string {
            var identity = Identity(run)

            if run.HarnessPath != "" {
                identity = J.Hash(identity + ":" + run.HarnessPath)
            }

            if Harness.Owns(run.Harness, "claude-profile") {
                identity = J.Hash(identity + ":" + run.ClaudeProfile)
            }

            identity = J.Hash(identity + ":" + run.Attempt)

            if ContributionHandoff.Has(run) {
                identity = J.Hash(identity + ":" + RequestData.Canonical(run.Handoff))
            }

            if run.Gratis {
                identity = J.Hash(identity + ":" + RequestData.Canonical(run.GratisContext))
            }

            return AttemptContinuation.Has(run) ? J.Hash(
                identity + ":" + run.ContinuationSource + ":" + RequestData.Canonical(run.Continuation) +
                    ":" +
                    run.ContinuationSourceMetadataSha256
            ): identity
        }

        internal func Initialize(directory string, run Data, fork string) {
            for entry in Directory.EnumerateFileSystemEntries(directory) {
                if Path.GetFileName(entry) != ".lock" {
                    Reject(directory)
                }
            }

            run.RequestedFork = fork
            run.PreparationVersion = 1
            run.PreparationIdentity = BoundIdentity(run)
            run.Transition("preparing")

            WriteNew(directory, run)
        }

        internal func Pending(directory string, run Data) {
            for entry in Directory.EnumerateFileSystemEntries(directory) {
                if Path.GetFileName(entry) != ".lock" {
                    Reject(directory)
                }
            }

            WriteNew(directory, run)
        }

        private func WriteNew(directory string, run Data) {
            using let file = FileStream(
                Path.Combine(directory, "run.json"),
                FileStreamOptions{
                    Mode: FileMode.CreateNew,
                    Access: FileAccess.Write,
                    Share: FileShare.None,
                    UnixCreateMode: UnixFileMode.UserRead | UnixFileMode.UserWrite
                }
            )
            using let writer = StreamWriter(file)

            writer.Write(run.ToJson() + "\n")
            writer.Flush()
            file.Flush(true)
        }

        internal func Promote(directory string, run Data, approvedBase string) {
            let pending = Data.Load(directory)
            if pending.Version != 2 ||
                pending.State != "claim_pending" ||
                pending.HasId ||
                pending.HasAttempt ||
                pending.HasPreparationIdentity ||
                pending.Base != approvedBase {
                Reject(directory)
            }

            for entry in Directory.EnumerateFileSystemEntries(directory) {
                if Array.IndexOf([]string{".lock", "run.json", "claim.posting.json"}, Path.GetFileName(entry)) < 0 {
                    Reject(directory)
                }
            }

            for key in "version,repo,issue,donor,donor_id,approval,base_branch,policy_hash,source,tools,seconds,verification_reserve,unlimited,harness,harness_path,provider,model,requested_model,reported_model,effort,selection,pi_endpoint,pi_root,pi_node,claude_profile,requested_fork,claim_request,handoff"
                .Split(',') {
                if !RequestData.Same(J.Get(pending.Element(), key), J.Get(run.Element(), key)) {
                    Reject(directory)
                }
            }

            run.PreparationVersion = 1
            run.PreparationIdentity = BoundIdentity(run)
            run.Transition("preparing")

            run.Save(directory)
        }

        private func Reject(path string) {
            throw CliFailure(
                "invalid_state",
                "Preserved unidentified, dirty or divergent preparation at " +
                    path +
                    ". Inspect and move it aside explicitly, or use its original saved run; then use work --run DIR. No files or branches were replaced."
            )
        }

        internal func Complete(directory string, run Data) {
            AttemptContinuation.Location(directory, run)

            let savedState = run.State
            let failure = "work --run requires recorded pre-inference preparation for this contribution; old runs and coding cannot be adopted"

            if run.PreparationVersion != 1 || !Identified(run) {
                throw CliFailure("invalid_state", failure)
            }

            if savedState != "preparing" && savedState != "claimed" {
                throw CliFailure("invalid_state", failure)
            }

            var started = run.HasCommit
            for name in Harness.Table.Keys {
                started = started || run.HasHarnessVersion(name)
            }
            if started {
                throw CliFailure("invalid_state", failure)
            }

            let eventsPath = Path.Combine(directory, "events.jsonl")
            let reportPath = Path.Combine(directory, "report.md")

            if File.Exists(eventsPath) || File.Exists(reportPath) {
                throw CliFailure("invalid_state", failure)
            }

            let record = ContributionAuthority.Recheck(run)

            if AttemptContinuation.Has(run) && run.ContinuationPhase == "" {
                ContinuationImport.Capture(directory, run, record)
            }

            let upstream = GitHub.Api("repos/" + RepositoryIdentity.Repo(run.Repo))

            if run.HasPreparationRepoId && J.Get(upstream, "id").ToString() != run.PreparationRepoId.ToString() {
                throw CliFailure("stale_approval", "Selected upstream repository identity changed")
            }

            run.PreparationRepoId = RepositoryIdentity.PositiveId(J.Get(upstream, "id"))

            run.Save(directory)

            Fork(directory, run, upstream)
            Branch(directory, run)

            let checkout = Checkout(directory, run)

            ContributionAuthority.Recheck(run)
            CheckFork(run, upstream)
            CheckBranch(run)

            if AttemptContinuation.Has(run) {
                Source(checkout, run)
                ContinuationImport.Import(directory, run, record)
            } else {
                Clean(checkout, run)
            }

            run.PreparationComplete = true
            run.Transition("claimed")

            run.Save(directory)

            Output.Sink.Step(
                (run.Gratis ? "Selected source ": "Approved source ") + run.Base + " for target " + run.BaseBranch
            )
            if run.Source == "external" {
                Output.Sink.Step(
                    "External coding checkout: " + checkout + "; independent verification uses DIR/checkout"
                )
                Output.Sink.Step(
                    "Push it with: git -C '" + checkout.Replace("'", "'\"'\"'") +
                        "' push " +
                        GitHub.WebUrl +
                        run.HeadRepo +
                        ".git HEAD:" +
                        GitHub.HeadsRefPrefix +
                        run.Branch
                )
            }
        }

        internal func Ready(directory string, run Data) {
            AttemptContinuation.Location(directory, run)

            if !run.PreparationComplete || !Identified(run) {
                throw CliFailure("invalid_state", "Preparation is incomplete; use work --run " + directory)
            }

            let upstream = GitHub.Api("repos/" + run.Repo)

            if J.Get(upstream, "id").ToString() != run.PreparationRepoId.ToString() {
                throw CliFailure("stale_approval", "Selected upstream repository identity changed")
            }

            CheckFork(run, upstream)
            CheckBranch(run)

            let checkout = Path.Combine(directory, run.Source == "external" ? "coding": "checkout")

            if AttemptContinuation.Has(run) {
                Source(checkout, run)
                if run.ContinuationPhase != "imported" {
                    throw CliFailure("invalid_state", "Continuation import is incomplete; use work --run " + directory)
                }

                ContinuationImport.Check(directory, run, ContributionAuthority.Recheck(run))
            } else {
                Clean(checkout, run)
            }
        }

        internal func Select(run Data, requested string) {
            let upstream = GitHub.Api("repos/" + RepositoryIdentity.Repo(run.Repo))
            var head = requested

            if head == "" && RepositoryIdentity.PositiveId(
                J.Get(J.Get(upstream, "owner"), "id")
            ) == RepositoryIdentity.PositiveId(run.DonorId) {
                head = run.Repo
            }

            if head == "" {
                ApiTransport.BeginDeadline(ForkDiscoveryTimeoutSeconds)
                try {
                    let candidates = List[string]()
                    var complete bool

                    for page in 1 ... ForkDiscoveryPageCountLimit + 1 {
                        let items = GitHub.Api(
                            "user/repos?visibility=public&affiliation=owner&" +
                                GitHub.PageSizeParameter +
                                "&page=" +
                                page.ToString()
                        )

                        if items.ValueKind != JsonValueKind.Array {
                            throw CliFailure(
                                "invalid_state",
                                "Incomplete fork discovery; select --fork DONOR/NAME explicitly"
                            )
                        }

                        let pageItems = J.Items(items)

                        for item in pageItems {
                            if !J.Bool(item, "fork") || RepositoryIdentity.PositiveId(
                                J.Get(J.Get(item, "owner"), "id")
                            ) !=
                            RepositoryIdentity.PositiveId(run.DonorId) {
                                continue
                            }

                            let candidate = RepositoryIdentity.Repo(J.Text(item, "full_name"))
                            let info = GitHub.Api("repos/" + candidate)

                            if String.Equals(
                                J.Text(J.Get(info, "parent"), "full_name"),
                                run.Repo,
                                StringComparison.OrdinalIgnoreCase
                            ) {
                                RepositoryAccess.ValidateRepository(
                                    run.Repo,
                                    candidate,
                                    run.DonorId,
                                    info,
                                    upstream: upstream
                                )

                                if !candidates.Contains(candidate) {
                                    candidates.Add(candidate)
                                }
                            }
                        }

                        if pageItems.Count < GitHub.PageSize {
                            complete = true
                            break
                        }
                    }

                    if !complete || candidates.Count > 1 {
                        throw CliFailure(
                            "invalid_state",
                            "Ambiguous or incomplete fork discovery; select --fork DONOR/NAME explicitly in a fresh preparation"
                        )
                    }

                    head = candidates.Count == 1 ? candidates[0]: run.Donor + "/" + run.Repo.Split('/')[1]
                } catch (error ApiDeadlineException) {
                    throw CliFailure(
                        "invalid_state",
                        "Incomplete fork discovery after 60 seconds; select --fork DONOR/NAME explicitly"
                    )
                } finally {
                    ApiTransport.EndDeadline()
                }
            }

            run.PreparationHead = RepositoryIdentity.Repo(head)
            run.HeadRepo = head
            run.PreparationRepoId = RepositoryIdentity.PositiveId(J.Get(upstream, "id"))
        }

        private func Fork(directory string, run Data, upstream JsonElement) {
            let head = RepositoryIdentity.Repo(run.PreparationHead)

            if !RepositoryIdentity.SameRepo(run.HeadRepo, head) {
                throw CliFailure("invalid_state", "Saved head repository differs from preparation identity")
            }

            var info = GitHub.Api("repos/" + head, missing: true)

            if info.ValueKind == JsonValueKind.Undefined && !run.ForkCreationAttempted {
                let donor = run.Donor
                let repo = run.Repo

                if !String.Equals(head.Split('/')[0], donor, StringComparison.OrdinalIgnoreCase) || String.Equals(
                    head,
                    repo,
                    StringComparison.OrdinalIgnoreCase
                ) {
                    throw CliFailure("invalid_state", "A missing fork must belong to the authenticated donor")
                }

                run.ForkCreationAttempted = true
                run.Save(directory)

                try {
                    let created = GitHub.Api(
                        "repos/" + run.Repo + "/forks",
                        map[string, Object?]{"name": head.Split('/')[1]}
                    )
                    RepositoryAccess.ValidateRepository(run.Repo, head, run.DonorId, created, upstream: upstream)

                    run.PreparationHeadId = RepositoryIdentity.PositiveId(J.Get(created, "id"))

                    run.Save(directory)
                } catch (error Exception) when error is CliFailure || error.GetType() == typeof(Exception) {
                    run.ForkCreationError = error.Message
                    run.Save(directory)
                }
            }

            for read in 0 ... RemoteReadAttemptLimit {
                if read > 0 {
                    select {
                        case <- after(TimeSpan.FromSeconds(RemoteReadDelaySeconds)) { }
                    }
                    info = GitHub.Api("repos/" + head, missing: true)
                }

                if info.ValueKind != JsonValueKind.Undefined {
                    RepositoryAccess.ValidateRepository(run.Repo, head, run.DonorId, info, upstream: upstream)

                    if run.HasPreparationHeadId && J.Get(info, "id").ToString() != run.PreparationHeadId.ToString() {
                        throw CliFailure("stale_approval", "Saved fork identity changed; inspect the original fork")
                    }

                    run.PreparationHeadId = RepositoryIdentity.PositiveId(J.Get(info, "id"))

                    run.Save(directory)

                    if run.ForkCreationAttempted {
                        let branch = RepositoryIdentity.Branch(J.Text(info, "default_branch"))
                        let ready = GitHub.Api(
                            "repos/" + head + "/git/ref/heads/" + Uri.EscapeDataString(branch),
                            missing: true
                        )

                        if ready.ValueKind == JsonValueKind.Undefined {
                            continue
                        }
                    }

                    return
                }
            }

            throw CliFailure(
                "invalid_state",
                "Fork creation is not ready or its response was lost. Inspect " +
                    head +
                    "; use work --run " +
                    directory +
                    " for bounded readiness reads. Creation will not be repeated."
            )
        }

        private func CheckFork(run Data, upstream JsonElement) {
            let info = GitHub.Api("repos/" + RepositoryIdentity.Repo(run.HeadRepo))

            RepositoryAccess.ValidateRepository(run.Repo, run.HeadRepo, run.DonorId, info, upstream: upstream)

            if J.Get(info, "id").ToString() != run.PreparationHeadId.ToString() {
                throw CliFailure("stale_approval", "Saved fork repository identity changed")
            }
        }

        private func Reference(run Data) JsonElement -> GitHub.Api(
            "repos/" + RepositoryIdentity.Repo(run.HeadRepo) + "/git/ref/heads/" + Uri.EscapeDataString(
                RepositoryIdentity.Branch(run.Branch)
            ),
            missing: true
        )

        private func CheckBranch(run Data) {
            let reference = Reference(run)

            if reference.ValueKind == JsonValueKind.Undefined {
                throw CliFailure(
                    "invalid_state",
                    "The recorded contribution branch is missing. Inspect remote state and the saved creation result; preparation never repeats a branch mutation. Use the original run after explicitly restoring its approved base branch."
                )
            }

            if J.Text(J.Get(reference, "object"), "sha") != run.Base {
                throw CliFailure(
                    "invalid_state",
                    "Existing branch work is preserved; continuation remains unsupported until #14"
                )
            }
        }

        private func Branch(directory string, run Data) {
            let reference = Reference(run)

            if !run.BranchCreationAttempted {
                if reference.ValueKind != JsonValueKind.Undefined {
                    ContributionAuthority.Recheck(run)
                    CheckBranch(run)

                    let pulls = J.Items(
                        GitHub.Api(
                            "repos/" + run.Repo + "/pulls?state=all&head=" + Uri.EscapeDataString(
                                run.Donor + ":" + run.Branch
                            )
                        )
                    )

                    if pulls.Count != 0 {
                        throw CliFailure(
                            "invalid_state",
                            "Partial publication is preserved; continuation remains unsupported until #14"
                        )
                    }

                    run.BranchCreationAttempted = true
                    run.BranchPrepared = true
                    run.Save(directory)
                    return
                }

                run.BranchCreationAttempted = true
                run.Save(directory)

                try {
                    GitHub.Api(
                        "repos/" + run.HeadRepo + "/git/refs",
                        map[string, Object?]{"ref": GitHub.HeadsRefPrefix + run.Branch, "sha": run.Base}
                    )
                } catch (error CliFailure) {
                    run.BranchCreationError = error.Message
                    run.Save(directory)
                }

                for attempt in 0 ... RemoteReadAttemptLimit {
                    if Reference(run).ValueKind != JsonValueKind.Undefined {
                        break
                    }

                    ApiTransport.Settle()
                }
            }

            CheckBranch(run)

            run.BranchPrepared = true

            run.Save(directory)
        }

        private func Marker(run Data) string -> J.Write(
            map[string, Object?]{
                "identity": run.PreparationIdentity,
                "head_repo": run.PreparationHead,
                "head_id": run.PreparationHeadId,
                "repo_id": run.PreparationRepoId
            }
        )

        private func Owned(checkout string, run Data) {
            LocalPaths.DirectoryPath(checkout)
            LocalPaths.DirectoryPath(Path.Combine(checkout, ".git"))

            let marker = Path.Combine(checkout, ".git/tokate-preparation.json")

            if FileInfo(marker).LinkTarget != nil || !File.Exists(marker) || File.ReadAllText(marker) != Marker(run) {
                Reject(checkout)
            }
        }

        private func Metadata(checkout string) {
            let allowed = []string{
                "core.repositoryformatversion=0",
                "core.filemode=true",
                "core.bare=false",
                "core.logallrefupdates=true"
            }

            for entry in Commands.Git(checkout, "config", "--local", "--no-includes", "--list").Split('\n') {
                if Array.IndexOf(allowed, entry) < 0 {
                    Reject(checkout)
                }
            }

            for name in[]string{"info/attributes", "info/exclude", "hooks"} {
                let path = Path.Combine(checkout, ".git", name)
                if File.Exists(path) || (Directory.Exists(path) && Directory.GetFileSystemEntries(path).Length > 0) {
                    Reject(checkout)
                }
            }
        }

        internal func Source(checkout string, run Data) {
            if run.PreparationVersion != 1 || !Identified(run) {
                throw CliFailure("invalid_state", "Unsupported preparation identity; source is preserved")
            }

            Owned(checkout, run)
            Verification.Candidate(checkout)
            Metadata(checkout)

            let head = Commands.Git(checkout, "rev-parse", "HEAD")
            let expected = ContributionHandoff.StartHead(run)

            if head != expected && !(ContributionHandoff.Has(run) && run.State == "preparing" && head == run.Base) {
                Reject(checkout)
            }

            let branch = Commands.GitResult(checkout, []string{"symbolic-ref", "--quiet", "--short", "HEAD"})

            if run.Source == "external" ? (branch.Code != 0 || branch.Output.Trim() != run.Branch): branch.Code != 1 {
                Reject(checkout)
            }

            let adapter = Harness.Find(run.Harness)
            if run.Source != "external" && adapter != nil && adapter.Config != "" {
                for file in Commands.Git(checkout, "ls-files").Split('\n') {
                    if file.StartsWith(adapter.Config + "/") || file.Contains("/" + adapter.Config + "/") {
                        throw CliFailure(
                            "invalid_state",
                            "Repository " + adapter.Title + " configuration is not supported in donor runs"
                        )
                    }
                }
            }
        }

        private func Clean(checkout string, run Data) {
            Source(checkout, run)
            if Commands.Git(checkout, "status", "--porcelain", "--untracked-files=all", "--ignored") != "" {
                Reject(checkout)
            }
        }

        private func CheckExisting(directory string, checkout string, staging string, run Data) {
            if AttemptContinuation.Has(run) &&
                (run.ContinuationPhase == "importing" || run.ContinuationPhase == "imported") {
                Source(checkout, run)
                ContinuationImport.Check(
                    directory,
                    run,
                    ContributionAuthority.Recheck(run),
                    run.ContinuationPhase == "importing"
                )
            } else {
                Clean(checkout, run)
                if ContributionHandoff.Has(run) {
                    ContributionHandoff.Import(checkout, run)
                    Clean(checkout, run)
                }
            }

            if Directory.Exists(staging) || File.Exists(staging) || FileInfo(staging).LinkTarget != nil {
                Reject(staging)
            }
        }

        private func Checkout(directory string, run Data) string {
            let name = run.Source == "external" ? "coding": "checkout"
            let checkout = Path.Combine(directory, name)
            let staging = Path.Combine(directory, name + ".staging")

            if Directory.Exists(checkout) || File.Exists(checkout) || FileInfo(checkout).LinkTarget != nil {
                CheckExisting(directory, checkout, staging, run)

                return checkout
            }

            if File.Exists(staging) || FileInfo(staging).LinkTarget != nil {
                Reject(staging)
            }

            if !Directory.Exists(staging) {
                run.CheckoutStaging = name + ".staging"
                run.Save(directory)
                Directory.CreateDirectory(Path.Combine(staging, ".git"))
                File.WriteAllText(Path.Combine(staging, ".git/tokate-preparation.json"), Marker(run))
            }

            Owned(staging, run)
            Verification.Validate(staging)

            if !File.Exists(Path.Combine(staging, ".git/config")) {
                for entry in Directory.EnumerateFileSystemEntries(Path.Combine(staging, ".git")) {
                    if Path.GetFileName(entry) != "tokate-preparation.json" {
                        Reject(staging)
                    }
                }

                Commands.Git(staging, "init", "--quiet", "--template=")
            }

            Metadata(staging)

            let head = Commands.GitResult(staging, []string{"rev-parse", "--verify", "HEAD"})

            if head.Code == 0 {
                Clean(staging, run)
            } else {
                if Commands.Git(staging, "for-each-ref", "--format=%(refname)") != "" || Commands.Git(
                    staging,
                    "ls-files"
                ) != "" {
                    Reject(staging)
                }

                for entry in Directory.EnumerateFileSystemEntries(staging) {
                    if Path.GetFileName(entry) != ".git" {
                        Reject(staging)
                    }
                }

                if File.Exists(Path.Combine(staging, ".git/config")) {
                    Verification.Validate(staging)
                    Metadata(staging)
                }

                Commands.Git(staging, "init", "--quiet", "--template=")

                Verification.Validate(staging)
                Metadata(staging)

                Commands.Git(
                    staging,
                    "fetch",
                    "--quiet",
                    "--no-tags",
                    "--no-recurse-submodules",
                    "--",
                    GitHub.WebUrl + run.Repo + ".git",
                    RepositoryIdentity.CommitSha(run.Base)
                )

                if run.Source == "external" {
                    Commands.Git(staging, "checkout", "--quiet", "-b", RepositoryIdentity.Branch(run.Branch), run.Base)
                } else {
                    Commands.Git(staging, "checkout", "--quiet", "--detach", run.Base)
                }

                Clean(staging, run)
            }

            ContributionHandoff.Import(staging, run)

            Directory.Move(staging, checkout)

            Clean(checkout, run)

            run.CheckoutPrepared = name

            run.Save(directory)

            return checkout
        }
    }
}
