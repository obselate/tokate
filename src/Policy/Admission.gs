package Tokate

import System
import System.Collections.Generic
import System.Text.Json
import System.Text.RegularExpressions

internal class Admission {
    shared {
        internal func Run(args Args) {
            let repo = RepositoryIdentity.Repo(args.Need("repo"))
            let event = RequestData.FileData(args.Need("event"), 1024 * 1024)
            let actions = []string{
                "opened",
                "reopened",
                "synchronize",
                "edited",
                "ready_for_review",
                "converted_to_draft",
                "labeled",
                "unlabeled",
                "assigned",
                "unassigned"
            }
            let number = J.Number(J.Get(event, "pull_request"), "number")
            let repository = J.Get(event, "repository")

            if Environment.GetEnvironmentVariable("GITHUB_EVENT_NAME") != "pull_request_target" || Array.IndexOf(
                actions,
                J.Text(event, "action")
            ) < 0 ||
                number < 1 ||
                !RepositoryIdentity
                .SameRepo(J.Text(repository, "full_name"), repo) {
                throw CliFailure(
                    "invalid_arguments",
                    "Admission event " + args.Need("event") +
                        " requires a supported action, pull_request.number and repository.full_name matching " +
                        repo +
                        ". Run admission in the upstream pull_request_target workflow with its complete --event."
                )
            }

            let repoId = RepositoryIdentity.PositiveId(J.Get(repository, "id"))
            let path = "repos/" + repo + "/pulls/" + number.ToString()
            var pull = GitHub.Api(path)
            var policy = CurrentPolicy(repo, repoId, pull, number)

            if J.Text(pull, "state") != "open" || Allowed(repo, repoId, pull, policy) {
                Result(repo, number, J.Text(pull, "state"))
                return
            }

            let marker = "<!-- tokate-admission:v1 -->"
            var commented bool

            for page in 1 ... 11 {
                let comments = GitHub.Api(
                    "repos/" + repo + "/issues/" + number.ToString() + "/comments?per_page=100&page=" + page.ToString()
                )

                if comments.ValueKind != JsonValueKind.Array {
                    throw Exception("Malformed canonical PR comments")
                }

                for comment in J.Items(comments) {
                    let user = J.Get(comment, "user")
                    commented = commented ||
                        (
                        J.Text(user, "login") == "github-actions[bot]" && J.Text(user, "type") == "Bot" && J.Text(
                            comment,
                            "body"
                        )
                            .Contains(marker)
                    )
                }

                if comments.GetArrayLength() < 100 {
                    break
                }

                if page == 10 {
                    throw Exception("PR comment inspection exceeded its bounded page limit")
                }
            }

            pull = GitHub.Api(path)
            policy = CurrentPolicy(repo, repoId, pull, number)

            if J.Text(pull, "state") != "open" || Allowed(repo, repoId, pull, policy) {
                Result(repo, number, J.Text(pull, "state"))
                return
            }

            let message = policy.CloseMessage
            if !commented && message != "" {
                GitHub.Api(
                    "repos/" + repo + "/issues/" + number.ToString() + "/comments",
                    map[string, Object?]{"body": message + "\n\n" + marker}
                )
            }

            pull = GitHub.Api(path)
            policy = CurrentPolicy(repo, repoId, pull, number)

            if J.Text(pull, "state") != "open" || Allowed(repo, repoId, pull, policy) {
                Result(repo, number, J.Text(pull, "state"))
                return
            }

            GitHub.Api(path, map[string, Object?]{"state": "closed"}, "PATCH")

            Result(repo, number, "closed")
        }

        private func Result(repo string, number int32, state string) {
            Output.Sink.ResultData = map[string, Object?]{"repo": repo, "pr": number, "admission": state}
            Output.Sink.Message("Admission: PR #" + number.ToString() + " " + state)
        }

        private func CurrentPolicy(repo string, repoId int64, pull JsonElement, number int32) Policy {
            let info = GitHub.Api("repos/" + repo)
            let target = J.Get(J.Get(pull, "base"), "repo")

            if RepositoryIdentity.PositiveId(J.Get(info, "id")) != repoId || !RepositoryIdentity.SameRepo(
                J.Text(info, "full_name"),
                repo
            ) ||
                RepositoryIdentity.PositiveId(J.Get(target, "id")) != repoId || !RepositoryIdentity.SameRepo(
                J.Text(target, "full_name"),
                repo
            ) ||
                J.Number(pull, "number") != number ||
                (J.Text(pull, "state") != "open" && J.Text(pull, "state") != "closed") {
                throw Exception("Canonical PR or upstream repository identity changed")
            }

            return Policy.Load(repo, GitHub.Branch(repo, J.Text(info, "default_branch")))
        }

        private func Nomination(repo string, pull JsonElement) int32 {
            let issues = HashSet[int32]()
            let body = J.Text(pull, "body")

            try {
                let receipt = RequestData.Parse(
                    PrBody.ReceiptText(body, "PR needs exactly one Tokate receipt"),
                    1024 * 1024
                )
                let nominatedRepo = JsonFields.String(receipt, "PR receipt nomination", "repo")
                let issue = JsonFields.Int32(receipt, "PR receipt nomination", "issue")
                if RepositoryIdentity.SameRepo(nominatedRepo, repo) && issue > 0 {
                    issues.Add(issue)
                }
            } catch { }

            let pattern = "https://github\\.com/" + Regex.Escape(repo) + "/issues/([0-9]+)(?![0-9A-Za-z_/])"
            for match Match in Regex.Matches(body, pattern, RegexOptions.IgnoreCase) {
                var issue int32
                if Int32.TryParse(match.Groups[1].Value, out issue) && issue > 0 {
                    issues.Add(issue)
                }
            }

            for match Match in Regex.Matches(body, "(?im)^\\s*(?:fixes|closes|resolves|issue)\\s*:?\\s*#([0-9]+)\\b") {
                var issue int32
                if Int32.TryParse(match.Groups[1].Value, out issue) && issue > 0 {
                    issues.Add(issue)
                }
            }

            if issues.Count != 1 {
                return 0
            }

            for issue in issues {
                return issue
            }

            return 0
        }

        private func Allowed(repo string, repoId int64, pull JsonElement, policy Policy) bool {
            let author = J.Get(pull, "user")
            var actor = RepositoryIdentity.PositiveId(J.Get(author, "id"))
            var login = J.Text(author, "login")
            let bot = J.Text(author, "type") == "Bot" || login.EndsWith("[bot]", StringComparison.Ordinal)

            if !bot {
                RepositoryIdentity.Login(login)
                let permission = GitHub.Api("repos/" + repo + "/collaborators/" + login + "/permission")

                if RepositoryIdentity.PositiveId(J.Get(J.Get(permission, "user"), "id")) != actor {
                    throw Exception("Canonical maintainer identity changed")
                }

                let level = J.Text(permission, "permission")
                if level == "admin" || level == "write" || level == "maintain" {
                    return true
                }

                if level != "read" && level != "none" && level != "triage" {
                    throw Exception("Malformed canonical maintainer permission")
                }
            }

            let access = AccessState.Load(repo, repoId)
            let mode = policy.Eligibility

            if !bot && access.Allows(actor, mode, JsonElement{}) {
                return true
            }

            var issue = Nomination(repo, pull)
            var state CoordinationState

            if bot {
                state = BoundState(repo, pull)
                if state.Sha == "" {
                    return false
                }

                issue = state.Issue
            } else {
                if issue == 0 {
                    if !J.Bool(pull, "draft") {
                        return false
                    }
                    state = BoundState(repo, pull)
                    if state.Sha == "" || state.Contribution != nil || RepositoryIdentity.PositiveId(
                        state.Lease?.ActorValue() ?? default(JsonElement)
                    ) != actor {
                        return false
                    }
                    issue = state.Issue
                } else {
                    state = CoordinationState.Load(repo, issue, missing: true)
                }
            }

            if state.Sha == "" {
                return false
            }

            let approval = state.Approval?.Value() ?? default(JsonElement)

            if !state.RevocationValid {
                throw Exception("Malformed coordination revocation state")
            }

            Authority(approval, repo, issue)
            if J.Text(J.Get(pull, "base"), "ref") != OwnerApproval.Record.Parse(approval).BaseBranch {
                return false
            }

            if bot {
                let binding = DonorBinding(repo, pull, state)
                if binding.ValueKind == JsonValueKind.Undefined {
                    return false
                }

                actor = RepositoryIdentity.PositiveId(
                    state.Contribution?.ActorValue() ?? state.Lease?.ActorValue() ?? default(JsonElement)
                )
                login = RepositoryIdentity.Login(state.Contribution?.Donor ?? state.Lease?.Donor ?? "")
                if access.Allows(actor, mode, JsonElement{}) {
                    return true
                }
            }

            if !access.Allows(actor, mode, approval) {
                return false
            }

            let task = GitHub.Api("repos/" + repo + "/issues/" + issue.ToString(), missing: true)
            if task.ValueKind == JsonValueKind.Undefined || J.Text(task, "state") != "open" || J.Get(
                task,
                "pull_request"
            )
                .ValueKind != JsonValueKind.Undefined {
                return false
            }

            try {
                state.Check(repo, issue, login, J.Parse(actor.ToString()))
                return true
            } catch (error CliFailure) {
                if error.Code == "stale_approval" ||
                    (
                    error.Code == "invalid_state" && J.Text(
                        J.Parse(J.Write(Output.Sink.ResultData)),
                        "authority"
                    ) != "unknown"
                ) {
                    return false
                }

                throw error
            }
        }

        internal func DonorBinding(
            repo string,
            pull JsonElement,
            state CoordinationState,
            requireLease bool = true
        ) JsonElement {
            let contribution = state.Contribution
            let current = state.Current()
            let outcome = current?.Outcome
            let head = J.Get(pull, "head")
            let headRepo = J.Get(head, "repo")
            let fork = J.Text(headRepo, "full_name")
            let branch = J.Text(head, "ref")
            let target = J.Text(J.Get(pull, "base"), "ref")

            if target != (state.Approval?.BaseBranch ?? "") {
                return JsonElement{}
            }

            var binding JsonElement

            if contribution != nil {
                let metadata = contribution.Metadata
                let publication = PublicationRequestMetadata.Parse(metadata)
                RepositoryIdentity.PositiveId(outcome?.PrValue() ?? default(JsonElement))
                RepositoryIdentity.CommitSha(outcome?.Head ?? "")
                RepositoryIdentity.Branch(publication.Branch)
                RepositoryIdentity.Repo(publication.Fork)

                if (outcome?.Pr ?? 0) != J.Number(pull, "number") ||
                    publication.Branch != branch ||
                    !RepositoryIdentity.SameRepo(publication.Fork, fork) {
                    return JsonElement{}
                }

                if (outcome?.Head ?? "") != J.Text(head, "sha") {
                    if !requireLease {
                        return JsonElement{}
                    }

                    let reservation = state.Lease
                    if reservation == nil ||
                        reservation.Status != "active" ||
                        branch != "tokate/v2-" +
                        reservation.Reservation ||
                        RepositoryIdentity.PositiveId(reservation.ActorValue()) != RepositoryIdentity.PositiveId(
                        contribution.ActorValue()
                    ) ||
                        !String.Equals(reservation.Donor, contribution.Donor, StringComparison.OrdinalIgnoreCase) {
                        return JsonElement{}
                    }

                    try {
                        state.Reservation(contribution.ActorValue())
                    } catch (error CliFailure) {
                        if error.Code == "stale_approval" {
                            return JsonElement{}
                        }

                        throw error
                    }
                }

                binding = contribution.Value()
            } else {
                let reservation = state.Lease
                if reservation == nil {
                    return JsonElement{}
                }

                let donor = reservation.Donor
                if LeaseLifecycle.Supported(state) && RepositoryIdentity.PositiveId(
                    state.Identity?.ActorValue() ?? default(JsonElement)
                ) != RepositoryIdentity.PositiveId(reservation.ActorValue()) {
                    return JsonElement{}
                }

                if branch != "tokate/v2-" + reservation.Reservation || !fork.StartsWith(
                    donor + "/",
                    StringComparison.OrdinalIgnoreCase
                ) {
                    return JsonElement{}
                }

                if requireLease {
                    try {
                        LeaseLifecycle.Owner(state, reservation.ActorValue(), active: true)
                    } catch (error CliFailure) {
                        if error.Code == "stale_approval" {
                            return JsonElement{}
                        }

                        throw error
                    }
                }

                binding = reservation.Value()
            }

            return ValidateDonorFork(
                repo,
                pull,
                binding,
                contribution?.ActorValue() ?? state.Lease?.ActorValue() ?? default(JsonElement),
                contribution?.Donor ?? state.Lease?.Donor ?? ""
            )
        }

        private func ValidateDonorFork(
            repo string,
            pull JsonElement,
            binding JsonElement,
            actorValue JsonElement,
            donor string
        ) JsonElement {
            let head = J.Get(pull, "head")
            let headRepo = J.Get(head, "repo")
            let fork = J.Text(headRepo, "full_name")
            let branch = J.Text(head, "ref")
            let actor = RepositoryIdentity.PositiveId(actorValue)
            let owner = J.Get(headRepo, "owner")

            if RepositoryIdentity.PositiveId(J.Get(owner, "id")) != actor || !String.Equals(
                J.Text(owner, "login"),
                donor,
                StringComparison.OrdinalIgnoreCase
            ) {
                return JsonElement{}
            }

            let live = GitHub.Api("repos/" + RepositoryIdentity.Repo(fork), missing: true)
            if live.ValueKind == JsonValueKind.Undefined {
                return JsonElement{}
            }

            let parent = J.Get(live, "parent")
            RepositoryIdentity.PositiveId(J.Get(live, "id"))

            if RepositoryIdentity.PositiveId(J.Get(J.Get(live, "owner"), "id")) != actor ||
                !RepositoryIdentity.SameRepo(J.Text(live, "full_name"), fork) ||
                (
                !RepositoryIdentity.SameRepo(fork, repo) &&
                    (
                    !J.Bool(live, "fork") || !RepositoryIdentity.SameRepo(J.Text(parent, "full_name"), repo) ||
                        RepositoryIdentity.PositiveId(J.Get(parent, "id")) != RepositoryIdentity.PositiveId(
                        J.Get(J.Get(J.Get(pull, "base"), "repo"), "id")
                    )
                )
            ) ||
                RepositoryIdentity.PositiveId(J.Get(live, "id")) != RepositoryIdentity.PositiveId(
                J.Get(headRepo, "id")
            ) {
                return JsonElement{}
            }

            let reference = GitHub.Api(
                "repos/" + fork + "/git/ref/heads/" + Uri.EscapeDataString(RepositoryIdentity.Branch(branch)),
                missing: true
            )

            if reference.ValueKind == JsonValueKind.Undefined || J.Text(J.Get(reference, "object"), "sha") != J.Text(
                head,
                "sha"
            ) {
                return JsonElement{}
            }

            return binding
        }

        private func BoundState(repo string, pull JsonElement) CoordinationState {
            let refs = GitHub.Api("repos/" + repo + "/git/matching-refs/heads/tokate/contributions/")
            if refs.ValueKind != JsonValueKind.Array || refs.GetArrayLength() > 1000 {
                throw Exception("Cannot inspect bounded canonical contribution bindings")
            }

            var result = CoordinationState()

            for reference in J.Items(refs) {
                let name = Regex.Match(J.Text(reference, "ref"), "^refs/heads/tokate/contributions/([0-9]+)$")
                var issue int32

                if !name.Success || !Int32.TryParse(name.Groups[1].Value, out issue) || issue < 1 || J.Text(
                    J.Get(reference, "object"),
                    "type"
                ) != "commit" {
                    throw Exception("Malformed canonical contribution reference")
                }

                let state = CoordinationState.At(repo, issue, J.Text(J.Get(reference, "object"), "sha"))
                Authority(state.Approval?.Value() ?? default(JsonElement), repo, issue)

                if DonorBinding(repo, pull, state).ValueKind == JsonValueKind.Undefined {
                    continue
                }

                if result.Sha != "" {
                    return CoordinationState()
                }

                result = state
            }

            return result
        }

        private func Authority(approval JsonElement, repo string, issue int32) {
            let approved = OwnerApproval.Record.Parse(approval)
            if approved.Version != 2 || approved.Issue != issue || !RepositoryIdentity.SameRepo(approved.Repo, repo) {
                throw Exception("Malformed trusted admission approval identity")
            }

            RepositoryIdentity.CommitSha(approved.Base)
            RepositoryIdentity.Branch(approved.BaseBranch)
            RepositoryIdentity.Branch(approved.AuthorityBranch)

            for digest in[]string{approved.PolicyHash, approved.TemplateHash, approved.IssueHash} {
                if !Regex.IsMatch(digest, "^[0-9a-f]{64}$") {
                    throw Exception("Malformed trusted admission approval digest")
                }
            }

            AccessState.Task(approval)
        }
    }
}
