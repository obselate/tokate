package Tokate

import System
import System.Collections.Generic
import System.Text.Json

internal class AccessState {
    internal var Sha string = ""
    internal var RepoId int64
    internal let Members List[JsonElement] = List[JsonElement]()

    internal func Allows(actor int64, mode string, approval JsonElement) bool -> Refusal(actor, mode, approval) == ""

    private func Refusal(actor int64, mode string, approval JsonElement) string {
        var trusted bool
        var denied bool

        for member in Members {
            if RepositoryIdentity.PositiveId(J.Get(member, "actor")) == actor {
                trusted = J.Bool(member, "trusted")
                denied = J.Bool(member, "denied")
            }
        }

        if denied {
            return "Donor is denied."
        }

        if mode == "open" || trusted {
            return ""
        }

        for allowed in J.Items(J.Get(approval, "allowed_actor_ids")) {
            if RepositoryIdentity.PositiveId(allowed) == actor {
                return ""
            }
        }

        return "Missing donor trust and issue approval access."
    }

    internal func Value() JsonElement -> J.Parse(
        J.Write(map[string, Object?]{"version": 1, "repo_id": RepoId, "members": Members})
    )

    internal func Write(repo string, expected string, identity Object) bool {
        let text = J.Write(Value())
        RequestData.Parse(text, 65536)

        let tree = GitHub.Api(
            "repos/" + repo + "/git/trees",
            map[string, Object?]{
                "tree": []Object{
                    map[string, Object?]{"path": "access.json", "mode": "100644", "type": "blob", "content": text}
                }
            }
        )

        let commit = GitHub.Api(
            "repos/" + repo + "/git/commits",
            GitHub.AutomationCommit("Tokate donor access", J.Text(tree, "sha"), []string{expected}, identity)
        )
        let next = RepositoryIdentity.CommitSha(J.Text(commit, "sha"))

        try {
            if Sha == "" {
                GitHub.Api(
                    "repos/" + repo + "/git/refs",
                    map[string, Object?]{"ref": "refs/heads/tokate/access", "sha": next}
                )
            } else {
                GitHub.Api(
                    "repos/" + repo + "/git/refs/heads/tokate/access",
                    map[string, Object?]{"sha": next, "force": false},
                    "PATCH"
                )
            }
        } catch (error Exception) {
            var live AccessState
            try {
                live = Load(repo, RepoId)
            } catch (inspection Exception) {
                throw CliFailure(
                    "invalid_state",
                    "Access write outcome could not be inspected. Read the owner access ref before an explicit new operation; no write was repeated."
                )
            }

            if live.Sha != next || RequestData.Canonical(live.Value()) != RequestData.Canonical(Value()) {
                if Sha == "" &&
                    live.Sha != "" &&
                    error is CliFailure transport &&
                    (transport.HttpStatus == 409 || transport.HttpStatus == 422) {
                    return false
                }

                throw CliFailure(
                    "invalid_state",
                    "Access write is uncertain or lost a concurrent update. Inspect current access before an explicit new operation; no write was repeated."
                )
            }
        }

        Sha = next
        return true
    }

    shared {
        internal func Mode(policy JsonElement) string -> J.Text(policy, "eligibility")

        internal func Task(approval JsonElement) bool {
            RequestData.Parse(J.Write(approval), 1024 * 1024)
            let eligibility = Mode(approval)
            let donor = J.Get(approval, "donor")

            if J.Number(approval, "version") != 2 || J.Text(approval, "approval_scope") != "task" ||
                (eligibility != "open" && eligibility != "trusted") ||
                donor.ValueKind != JsonValueKind.Undefined {
                throw CliFailure("stale_approval", "Malformed or contradictory task eligibility approval")
            }

            RepositoryIdentity.PositiveId(J.Get(approval, "repo_id"))
            let allowed = J.Get(approval, "allowed_actor_ids")
            if allowed.ValueKind != JsonValueKind.Undefined && allowed.ValueKind != JsonValueKind.Array {
                throw CliFailure("stale_approval", "Malformed issue approval access")
            }
            let actors = HashSet[int64]()
            for actor in J.Items(allowed) {
                if !actors.Add(RepositoryIdentity.PositiveId(actor)) {
                    throw CliFailure("stale_approval", "Duplicate issue approval donor")
                }
            }

            return true
        }

        internal func Load(repo string, repoId int64) AccessState {
            let result = AccessState{RepoId: repoId}
            let reference = GitHub.Api("repos/" + repo + "/git/ref/heads/tokate/access", missing: true)

            if reference.ValueKind == JsonValueKind.Undefined {
                return result
            }

            if J.Text(J.Get(reference, "object"), "type") != "commit" {
                throw Exception("Donor access ref must identify a commit")
            }

            result.Sha = RepositoryIdentity.CommitSha(J.Text(J.Get(reference, "object"), "sha"))
            let value = RequestData.Parse(GitHub.FileAt(repo, "access.json", result.Sha), 65536)
            RequestData.Keys(value, "version,repo_id,members")
            let members = J.Get(value, "members")
            if J.Number(value, "version") != 1 || RepositoryIdentity.PositiveId(J.Get(value, "repo_id")) != repoId ||
                members.ValueKind != JsonValueKind.Array {
                throw Exception("Invalid donor access repository identity or membership")
            }

            let actors = HashSet[int64]()

            for member in J.Items(members) {
                RequestData.Keys(member, "actor,trusted,denied,issues")
                let actor = RepositoryIdentity.PositiveId(J.Get(member, "actor"))

                if !actors.Add(actor) {
                    throw Exception("Invalid or duplicate donor access membership")
                }

                for flag in[]string{"trusted", "denied"} {
                    let item = J.Get(member, flag)
                    if item.ValueKind != JsonValueKind.True && item.ValueKind != JsonValueKind.False {
                        throw Exception("Invalid donor access flag")
                    }
                }

                if !J.Bool(member, "trusted") && !J.Bool(member, "denied") {
                    if J.Get(member, "issues").ValueKind != JsonValueKind.Undefined {
                        continue
                    }
                    throw Exception("Empty donor access membership")
                }

                result.Members.Add(
                    J.Get(member, "issues").ValueKind == JsonValueKind.Undefined ? member:
                    J.Parse(J.Write(J.Select(member, "actor,trusted,denied")))
                )
            }

            return result
        }

        internal func Check(repo string, issue int32, approval JsonElement, actor JsonElement, policy JsonElement) {
            Task(approval)

            PublicOutput.ResultData = map[string, Object?]{
                "repo": repo,
                "issue": issue,
                "eligible": false,
                "authority": "unknown"
            }
            try {
                let id = RepositoryIdentity.PositiveId(actor)
                let info = GitHub.Api("repos/" + repo)
                let repoId = RepositoryIdentity.PositiveId(J.Get(info, "id"))

                if repoId != RepositoryIdentity.PositiveId(J.Get(approval, "repo_id")) {
                    throw Exception("Task repository numeric identity changed")
                }

                let mode = Mode(policy)
                let access = Load(repo, repoId)
                let allowed = access.Allows(id, mode, approval)

                PublicOutput.ResultData = map[string, Object?]{
                    "repo": repo,
                    "issue": issue,
                    "actor": id,
                    "eligibility": mode,
                    "eligible": allowed,
                    "access_sha": access.Sha
                }

                if !allowed {
                    let donor = RepositoryIdentity.Login(J.Text(GitHub.Api("user/" + id.ToString()), "login"))
                    let reason = access.Refusal(id, mode, approval)
                    let command = reason == "Donor is denied." ?
                    []string{"tokate", "access", "restore", donor, repo}:
                    []string{"tokate", "approve", repo + "#" + issue.ToString(), donor}
                    let alternative = reason == "Donor is denied." ? "":
                    " Or grant trust for all issues: tokate access trust " + donor + " " + repo + "."
                    throw CliFailure(
                        "invalid_state",
                        "Eligibility mode: " + mode + ". " + reason + " The owner must run: " + String.Join(
                            " ",
                            command
                        ) +
                            "." +
                            alternative,
                        command
                    )
                }
            } catch (error CliFailure) {
                throw error
            } catch (error ApiDeadlineException) {
                throw error
            } catch (error Exception) {
                PublicOutput.ResultData = map[string, Object?]{
                    "repo": repo,
                    "issue": issue,
                    "eligible": false,
                    "authority": "unknown"
                }

                throw CliFailure(
                    "invalid_state",
                    "Donor access authority is unavailable or malformed. Inspect owner-controlled access before proceeding. The owner must run: tokate access list " +
                        repo,
                    []string{"tokate", "access", "list", repo}
                )
            }
        }

        private func Pages(path string) List[JsonElement] {
            let result = List[JsonElement]()

            for page in 1 ... 11 {
                let value = GitHub.Api(path + "per_page=100&page=" + page.ToString())

                if value.ValueKind != JsonValueKind.Array {
                    throw Exception("Expected a paginated GitHub list")
                }

                let rows = J.Items(value)
                result.AddRange(rows)

                if rows.Count < 100 {
                    return result
                }
            }

            throw Exception(
                "Access presentation exceeded 1000 records; inspect GitHub directly or restrict requests to one issue"
            )
        }

        private func AccessRequest(repo string, comment JsonElement) JsonElement {
            let body = J.Text(comment, "body")

            if !body.StartsWith("/tokate-access ") || body.Length > 2048 {
                return JsonElement{}
            }

            try {
                let request = RequestData.Parse(body.Substring(15), 2048)
                RequestData.Keys(request, "version,scope,issue")
                let issue = J.Number(request, "issue")
                let requestScope = J.Text(request, "scope")

                if J.Number(request, "version") != 1 ||
                    issue < 1 ||
                    (requestScope != "issue" && requestScope != "trust") ||
                    !RepositoryIdentity.IsIssueUrl(J.Text(comment, "issue_url"), repo, issue) {
                    return JsonElement{}
                }

                let user = J.Get(comment, "user")
                return J.Parse(
                    J.Write(
                        map[string, Object?]{
                            "comment": RepositoryIdentity.PositiveId(J.Get(comment, "id")),
                            "actor": RepositoryIdentity.PositiveId(J.Get(user, "id")),
                            "donor": RepositoryIdentity.Login(J.Text(user, "login")),
                            "issue": issue,
                            "scope": requestScope
                        }
                    )
                )
            } catch (error Exception) {
                return JsonElement{}
            }
        }

        private func RequestAccess(repo string, args Args) {
            if args.Get("donor") != "" {
                throw Exception("Access requests use the authenticated donor")
            }

            let issue = args.Number("issue")
            try {
                GitHub.Issue(repo, issue)
            } catch (error CliFailure) when error.Code == "invalid_state" {
                throw CliFailure("invalid_arguments", error.Message + " Choose an existing open issue reference.")
            }
            let viewer = GitHub.Api("user")
            let actor = RepositoryIdentity.PositiveId(J.Get(viewer, "id"))
            let requestScope = args.Get("trust") == "true" ? "trust": "issue"

            let comments = Pages("repos/" + repo + "/issues/" + issue.ToString() + "/comments?")

            for comment in comments {
                let request = AccessRequest(repo, comment)

                if request.ValueKind != JsonValueKind.Undefined && RepositoryIdentity.PositiveId(
                    J.Get(request, "actor")
                ) == actor &&
                    J.Text(request, "scope") == requestScope {
                    PublicOutput.ResultData = map[string, Object?]{
                        "repo": repo,
                        "issue": issue,
                        "scope": requestScope,
                        "posted": false,
                        "comment": J.Get(request, "comment")
                    }

                    Terminal.Message("An access request already exists; owner review is still required.")
                    return
                }
            }

            let comment = GitHub.Api(
                "repos/" + repo + "/issues/" + issue.ToString() + "/comments",
                map[string, Object?]{
                    "body": "/tokate-access " + J.Write(
                        map[string, Object?]{"version": 1, "scope": requestScope, "issue": issue}
                    )
                }
            )

            PublicOutput.ResultData = map[string, Object?]{
                "repo": repo,
                "issue": issue,
                "scope": requestScope,
                "posted": true,
                "comment": J.Get(comment, "id")
            }

            Terminal.Message(
                "Access requested. The owner can use approve ISSUE LOGIN or grant persistent trust. The request grants no eligibility."
            )
        }

        internal func Pending(
            repo string,
            access AccessState,
            pending List[JsonElement],
            issue int32 = 0,
            actor int64 = 0,
            bounded bool = false
        ) bool {
            let commentsPath = issue == 0 ? "/issues/comments?": "/issues/" + issue.ToString() + "/comments?"
            let seen = HashSet[string]()
            let approvals = Dictionary[int32, JsonElement]()
            let limit = bounded ? 2: 10

            for page in 1 ... limit + 1 {
                let value = GitHub.Api("repos/" + repo + commentsPath + "per_page=100&page=" + page.ToString())

                if value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > 100 {
                    throw Exception("Expected a bounded paginated GitHub request list")
                }

                for comment in J.Items(value) {
                    let request = AccessRequest(repo, comment)

                    if request.ValueKind == JsonValueKind.Undefined {
                        continue
                    }

                    let id = RepositoryIdentity.PositiveId(J.Get(request, "actor"))
                    if actor != 0 && id != actor {
                        continue
                    }

                    var resolved bool

                    for member in access.Members {
                        if RepositoryIdentity.PositiveId(J.Get(member, "actor")) != id {
                            continue
                        }

                        resolved = J.Bool(member, "denied") || J.Bool(member, "trusted")
                    }
                    if !resolved && J.Text(request, "scope") == "issue" {
                        let number = J.Number(request, "issue")
                        var approval JsonElement
                        if !approvals.TryGetValue(number, out approval) {
                            let state = CoordinationState.Load(repo, number, true).Value()
                            approval = J.Bool(state, "revoked") ? JsonElement{}: J.Get(state, "approval")
                            if approval.ValueKind == JsonValueKind.Object {
                                Task(approval)
                            }
                            approvals.Add(number, approval)
                        }
                        for allowed in J.Items(J.Get(approval, "allowed_actor_ids")) {
                            resolved = resolved || RepositoryIdentity.PositiveId(allowed) == id
                        }
                    }

                    let key = id.ToString() + ":" + J.Text(request, "scope") + ":" + J.Number(request, "issue")
                        .ToString()
                    if !resolved && seen.Add(key) {
                        pending.Add(request)
                    }
                }

                if value.GetArrayLength() < 100 {
                    return false
                }
            }

            if bounded {
                return true
            }

            throw Exception(
                "Access presentation exceeded 1000 records; inspect GitHub directly or restrict requests to one issue"
            )
        }

        private func Present(repo string, args Args) {
            let info = GitHub.Api("repos/" + repo)
            let access = Load(repo, RepositoryIdentity.PositiveId(J.Get(info, "id")))
            let donor = args.Get("donor")
            var actor int64

            if donor != "" {
                actor = RepositoryIdentity.PositiveId(
                    J.Get(GitHub.Api("users/" + RepositoryIdentity.Login(donor)), "id")
                )
            }

            let members = List[JsonElement]()
            let trusted = List[JsonElement]()

            for member in access.Members {
                if actor == 0 || RepositoryIdentity.PositiveId(J.Get(member, "actor")) == actor {
                    let displayed = map[string, Object?]{
                        "actor": J.Get(member, "actor"),
                        "trusted": J.Get(member, "trusted"),
                        "denied": J.Get(member, "denied")
                    }

                    let identity = GitHub.Api(
                        "user/" + RepositoryIdentity.PositiveId(J.Get(member, "actor")).ToString()
                    )

                    if RepositoryIdentity.PositiveId(J.Get(identity, "id")) != RepositoryIdentity.PositiveId(
                        J.Get(member, "actor")
                    ) {
                        throw Exception("Donor display identity changed")
                    }

                    displayed["donor"] = RepositoryIdentity.Login(J.Text(identity, "login"))
                    let row = J.Parse(J.Write(displayed))
                    members.Add(row)

                    if J.Bool(member, "trusted") && !J.Bool(member, "denied") {
                        trusted.Add(row)
                    }
                }
            }

            let history = AccessHistory(repo, args, actor)

            let pending = List[JsonElement]()
            if args.Subject == "list" {
                Pending(repo, access, pending, args.Get("issue") == "" ? 0: args.Number("issue"), actor)
            }

            PublicOutput.ResultData = map[string, Object?]{
                "repo": repo,
                "access_sha": access.Sha,
                "members": members,
                "trusted": trusted,
                "pending": pending,
                "history": history
            }

            if !PublicOutput.Enabled {
                if args.Subject == "history" {
                    Terminal.Json(J.Parse(J.Write(PublicOutput.ResultData)), "Donor access and owner review")
                } else {
                    Terminal.Heading("Donor access")

                    for member in trusted {
                        Terminal.Row("Trusted donor", J.Text(member, "donor"))
                    }

                    for member in members {
                        let login = J.Text(member, "donor")
                        if J.Bool(member, "denied") {
                            Terminal.Row("Denied donor", login)
                        }
                    }

                    for request in pending {
                        Terminal.Row(
                            "Pending request",
                            J.Text(request, "donor") + " #" + J.Number(request, "issue").ToString() + " (" + J.Text(
                                request,
                                "scope"
                            ) +
                                ")"
                        )
                    }

                    if members.Count == 0 && pending.Count == 0 {
                        Terminal.Message("No donor access or pending requests.", "default")
                    }
                }
            }
        }

        private func AccessHistory(repo string, args Args, actor int64) List[Object] {
            let history = List[Object]()

            if args.Subject == "history" {
                for pull in Pages("repos/" + repo + "/pulls?state=all&") {
                    try {
                        let receipt = PrBody.Receipt(J.Text(pull, "body"))
                        let headOwner = J.Get(J.Get(J.Get(pull, "head"), "repo"), "owner")
                        let donorId = RepositoryIdentity.PositiveId(J.Get(headOwner, "id"))
                        let donorLogin = RepositoryIdentity.Login(J.Text(headOwner, "login"))
                        if !RepositoryIdentity.SameRepo(J.Text(receipt, "repo"), repo) || !String.Equals(
                            J.Text(receipt, "donor"),
                            donorLogin,
                            StringComparison.OrdinalIgnoreCase
                        ) ||
                            (actor != 0 && donorId != actor) ||
                            (args.Get("issue") != "" && J.Number(receipt, "issue") != args.Number("issue")) {
                            continue
                        }

                        history.Add(
                            map[string, Object?]{
                                "pr": J.Number(pull, "number"),
                                "issue": J.Number(receipt, "issue"),
                                "donor": donorLogin,
                                "state": J.Text(pull, "state"),
                                "merged": J.Get(pull, "merged_at").ValueKind == JsonValueKind.String,
                                "evidence": "unverified PR receipt; inspect verify and owner review"
                            }
                        )
                    } catch (error Exception) { }
                }
            }

            return history
        }

        internal func Run(args Args) {
            let repo = RepositoryIdentity.Repo(args.Need("repo"))
            let operation = args.Subject

            if operation != "request" && args.Get("trust") != "" {
                throw Exception("Only access request takes --trust")
            }

            if operation == "request" {
                RequestAccess(repo, args)
                return
            }

            if operation == "list" || operation == "history" {
                Present(repo, args)
                return
            }

            if operation == "check" {
                if args.Get("donor") != "" {
                    throw Exception("Access check uses the authenticated donor")
                }

                let viewer = GitHub.Api("user")
                RepositoryIdentity.PositiveId(J.Get(viewer, "id"))
                let issue = args.Number("issue")
                let state = CoordinationState.Load(repo, issue)
                state.Check(repo, issue, RepositoryIdentity.Login(J.Text(viewer, "login")), J.Get(viewer, "id"))

                if !PublicOutput.Enabled {
                    Terminal.Message("You are eligible for approved issue #" + issue.ToString() + ".")
                }

                return
            }

            if Array.IndexOf([]string{"init", "trust", "untrust", "deny", "restore"}, operation) < 0 {
                throw Exception("Unknown access operation")
            }

            let owner = GitHub.Author(GitHub.Api("user"))
            let info = RepositoryAccess.RequireOwner(repo)
            let repoId = RepositoryIdentity.PositiveId(J.Get(info, "id"))

            var access = Load(repo, repoId)
            let actor int64 = operation == "init" ? 0: RepositoryIdentity.PositiveId(
                J.Get(GitHub.Api("users/" + RepositoryIdentity.Login(args.Need("donor"))), "id")
            )
            for attempt in 0 ... 2 {
                let expected = access.Sha == "" ? GitHub.Branch(repo, J.Text(info, "default_branch")): access.Sha
                if operation == "init" {
                    if access.Sha != "" {
                        throw CliFailure(
                            "invalid_state",
                            "Access already exists for " +
                                repo +
                                ". Inspect current membership with: tokate access list " +
                                repo
                        )
                    }
                } else {
                    ChangeMembership(access, actor, operation)
                }

                if access.Write(repo, expected, owner) {
                    break
                }
                if operation == "init" {
                    throw CliFailure(
                        "invalid_state",
                        "Access already exists for " +
                            repo +
                            ". Inspect current membership with: tokate access list " +
                            repo
                    )
                }
                access = Load(repo, repoId)
            }

            Terminal.Message(
                "Eligibility changes do not alter task scope approval. Revoked access blocks new work and publication; every PR requires owner review.",
                "cyan",
                true
            )

            PublicOutput.ResultData = map[string, Object?]{
                "repo": repo,
                "repo_id": repoId,
                "actor": actor,
                "operation": operation,
                "access_sha": access.Sha
            }

            if !PublicOutput.Enabled {
                let donor = args.Get("donor")
                Terminal.Message(
                    switch operation {
                        case "trust": "Trusted " + donor + " for future approved issues."
                        case "untrust": "Removed trust for " + donor + " on future approved issues."
                        case "deny": "Denied " + donor + " access to approved issues."
                        case "restore": "Removed the access denial for " + donor + "."
                        default: "Initialized donor access for " + repo + "."
                    }
                )

                if operation == "init" {
                    Terminal.Message(
                        "Tokate keeps its state in tokate/ branches; do not open or merge pull requests from them."
                    )
                }
            }
        }

        private func ChangeMembership(access AccessState, actor int64, operation string) {
            var trusted bool
            var denied bool
            var index int32 = -1

            for i in 0 ... access.Members.Count {
                let member = access.Members[i]
                if RepositoryIdentity.PositiveId(J.Get(member, "actor")) == actor {
                    index = i
                    trusted = J.Bool(member, "trusted")
                    denied = J.Bool(member, "denied")
                }
            }
            switch operation {
                case "trust" {
                    trusted = true
                }
                case "untrust" {
                    trusted = false
                }
                case "deny" {
                    denied = true
                }
                case "restore" {
                    denied = false
                }
            }

            if index >= 0 {
                access.Members.RemoveAt(index)
            }

            if trusted || denied {
                access.Members.Add(
                    J.Parse(J.Write(map[string, Object?]{"actor": actor, "trusted": trusted, "denied": denied}))
                )
            }
        }
    }
}
