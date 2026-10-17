package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text
import System.Text.Json

internal class AccessState {
    internal var Sha string = ""
    internal var RepoId int64
    internal let Members List[Member] = List[Member]()

    internal class Member(actor int64, trusted bool, denied bool, source JsonElement = default(JsonElement)) {
        internal let Actor int64 = actor
        internal let Trusted bool = trusted
        internal let Denied bool = denied
        private let Source JsonElement = source

        internal func Write(writer Utf8JsonWriter) {
            if Source.ValueKind != JsonValueKind.Undefined {
                Source.WriteTo(writer)
                return
            }

            writer.WriteStartObject()
            writer.WriteNumber("actor", Actor)
            writer.WriteBoolean("trusted", Trusted)
            writer.WriteBoolean("denied", Denied)
            writer.WriteEndObject()
        }
    }

    internal func Allows(actor int64, mode string, approval JsonElement) bool -> Refusal(actor, mode, approval) == ""

    private func Refusal(actor int64, mode string, approval JsonElement) string {
        var trusted bool
        var denied bool

        for member in Members {
            if member.Actor == actor {
                trusted = member.Trusted
                denied = member.Denied
            }
        }

        if denied {
            return "Donor is denied."
        }

        if mode == "open" || trusted {
            return ""
        }

        if approval.ValueKind == JsonValueKind.Undefined {
            return "Missing donor trust and issue approval access."
        }

        for allowed in OwnerApproval.Record.Parse(approval).AllowedActorIds {
            if allowed == actor {
                return ""
            }
        }

        return "Missing donor trust and issue approval access."
    }

    internal func Value() JsonElement -> J.Parse(ToJson())

    internal func ToJson() string {
        using let bytes = MemoryStream()
        using let writer = Utf8JsonWriter(bytes)

        writer.WriteStartObject()
        writer.WriteNumber("version", Version)
        writer.WriteNumber("repo_id", RepoId)
        writer.WriteStartArray("members")

        for member in Members {
            member.Write(writer)
        }

        writer.WriteEndArray()
        writer.WriteEndObject()
        writer.Flush()

        return Encoding.UTF8.GetString(bytes.ToArray())
    }

    internal func Write(repo string, expected string, identity Object) bool {
        let text = ToJson()
        RequestData.Parse(text, ByteLimit)

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
        private const FormatName string = "Access record"

        private const Version int32 = 1

        private const ByteLimit int32 = 65536

        internal func Mode(policy JsonElement) string -> Policy.Parse(policy).Eligibility

        internal func Task(approval JsonElement) OwnerApproval.Record {
            RequestData.Parse(J.Write(approval), 1024 * 1024)
            let approved = OwnerApproval.Record.Parse(approval)
            let eligibility = approved.Eligibility
            let donor = approved.Donor

            if approved.Version != 2 ||
                approved.ApprovalScope != "task" ||
                (eligibility != "open" && eligibility != "trusted") ||
                donor.ValueKind != JsonValueKind.Undefined {
                throw CliFailure("stale_approval", "Malformed or contradictory task eligibility approval")
            }

            if approved.RepoId < 1 {
                throw Exception("Expected a positive numeric GitHub identity")
            }
            if approved
                .AllowedActors
                .ValueKind != JsonValueKind.Undefined &&
                approved
                .AllowedActors
                .ValueKind != JsonValueKind.Array {
                throw CliFailure("stale_approval", "Malformed issue approval access")
            }

            let actors = HashSet[int64]()
            for actor in approved.AllowedActorIds {
                if actor < 1 {
                    throw Exception("Expected a positive numeric GitHub identity")
                }
                if !actors.Add(actor) {
                    throw CliFailure("stale_approval", "Duplicate issue approval donor")
                }
            }

            return approved
        }

        internal func Parse(value JsonElement) AccessState {
            RequestData.Keys(value, "version,repo_id,members")
            let version = JsonFields.Int64(value, FormatName, "version")
            let repoId = JsonFields.Int64(value, FormatName, "repo_id")
            let members = JsonFields.Array(value, FormatName, "members")

            if version != Version {
                throw CliFailure("invalid_state", FormatName + ": field \"version\" must be 1")
            }

            if repoId < 1 {
                throw CliFailure("invalid_state", FormatName + ": field \"repo_id\" must be positive")
            }

            let result = AccessState{RepoId: repoId}
            let actors = HashSet[int64]()

            for member in members.EnumerateArray() {
                RequestData.Keys(member, "actor,trusted,denied,issues")
                let actor = JsonFields.Int64(member, FormatName, "actor")
                let trusted = JsonFields.Bool(member, FormatName, "trusted")
                let denied = JsonFields.Bool(member, FormatName, "denied")
                var issues JsonElement = JsonElement{}
                member.TryGetProperty("issues", out issues)

                if actor < 1 || !actors.Add(actor) {
                    throw CliFailure("invalid_state", FormatName + ": field \"actor\" must be positive and unique")
                }

                if !trusted && !denied {
                    if issues.ValueKind != JsonValueKind.Undefined {
                        continue
                    }

                    throw CliFailure("invalid_state", "Empty donor access membership")
                }

                result.Members.Add(
                    Member(
                        actor,
                        trusted,
                        denied,
                        issues.ValueKind == JsonValueKind.Undefined ? member:
                        J.Parse(J.Write(J.Select(member, "actor,trusted,denied")))
                    )
                )
            }

            return result
        }

        internal func Load(repo string, repoId int64) AccessState {
            let reference = GitHub.Api("repos/" + repo + "/git/ref/heads/tokate/access", missing: true)

            if reference.ValueKind == JsonValueKind.Undefined {
                return AccessState{RepoId: repoId}
            }

            if J.Text(J.Get(reference, "object"), "type") != "commit" {
                throw Exception("Donor access ref must identify a commit")
            }

            let sha = RepositoryIdentity.CommitSha(J.Text(J.Get(reference, "object"), "sha"))
            let result = Parse(RequestData.Parse(GitHub.FileAt(repo, "access.json", sha), ByteLimit))

            if result.RepoId != repoId {
                throw Exception("Invalid donor access repository identity or membership")
            }

            result.Sha = sha
            return result
        }

        internal func Check(repo string, issue int32, approval JsonElement, actor JsonElement, policy JsonElement) {
            let approved = Task(approval)

            Output
                .Sink
                .ResultData = map[string, Object?]{
                "repo": repo,
                "issue": issue,
                "eligible": false,
                "authority": "unknown"
            }
            var loadingAccess = false
            try {
                let id = RepositoryIdentity.PositiveId(actor)
                let info = GitHub.Api("repos/" + repo)
                let repoId = RepositoryIdentity.PositiveId(J.Get(info, "id"))

                if repoId != approved.RepoId {
                    throw Exception("Task repository numeric identity changed")
                }

                let mode = Mode(policy)
                loadingAccess = true
                let access = Load(repo, repoId)
                loadingAccess = false
                let allowed = access.Allows(id, mode, approval)

                Output
                    .Sink
                    .ResultData = map[string, Object?]{
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
            } catch (error CliFailure) when !loadingAccess {
                throw error
            } catch (error ApiDeadlineException) {
                throw error
            } catch (error Exception) {
                Output
                    .Sink
                    .ResultData = map[string, Object?]{
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
                    Output
                        .Sink
                        .ResultData = map[string, Object?]{
                        "repo": repo,
                        "issue": issue,
                        "scope": requestScope,
                        "posted": false,
                        "comment": J.Get(request, "comment")
                    }

                    Output.Sink.Message("An access request already exists; owner review is still required.")
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

            Output
                .Sink
                .ResultData = map[string, Object?]{
                "repo": repo,
                "issue": issue,
                "scope": requestScope,
                "posted": true,
                "comment": J.Get(comment, "id")
            }

            Output.Sink.Message(
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
                        if member.Actor != id {
                            continue
                        }

                        resolved = member.Denied || member.Trusted
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
                        if approval.ValueKind == JsonValueKind.Object {
                            for allowed in OwnerApproval.Record.Parse(approval).AllowedActorIds {
                                resolved = resolved || allowed == id
                            }
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
                if actor == 0 || member.Actor == actor {
                    let displayed = map[string, Object?]{
                        "actor": member.Actor,
                        "trusted": member.Trusted,
                        "denied": member.Denied
                    }

                    let identity = GitHub.Api("user/" + member.Actor.ToString())

                    if RepositoryIdentity.PositiveId(J.Get(identity, "id")) != member.Actor {
                        throw Exception("Donor display identity changed")
                    }

                    displayed["donor"] = RepositoryIdentity.Login(J.Text(identity, "login"))
                    let row = J.Parse(J.Write(displayed))
                    members.Add(row)

                    if member.Trusted && !member.Denied {
                        trusted.Add(row)
                    }
                }
            }

            let history = AccessHistory(repo, args, actor)

            let pending = List[JsonElement]()
            if args.Subject == "list" {
                Pending(repo, access, pending, args.Get("issue") == "" ? 0: args.Number("issue"), actor)
            }

            Output
                .Sink
                .ResultData = map[string, Object?]{
                "repo": repo,
                "access_sha": access.Sha,
                "members": members,
                "trusted": trusted,
                "pending": pending,
                "history": history
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
                        if !RepositoryIdentity.SameRepo(receipt.Repo, repo) || !String.Equals(
                            receipt.Donor,
                            donorLogin,
                            StringComparison.OrdinalIgnoreCase
                        ) ||
                            (actor != 0 && donorId != actor) ||
                            (args.Get("issue") != "" && receipt.Issue != args.Number("issue")) {
                            continue
                        }

                        history.Add(
                            map[string, Object?]{
                                "pr": J.Number(pull, "number"),
                                "issue": receipt.Issue,
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

                if !Output.Sink.Enabled {
                    Output.Sink.Message("You are eligible for approved issue #" + issue.ToString() + ".")
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

            Output.Sink.Message(
                "Eligibility changes do not alter task scope approval. Revoked access blocks new work and publication; every PR requires owner review.",
                "cyan",
                true
            )

            Output
                .Sink
                .ResultData = map[string, Object?]{
                "repo": repo,
                "repo_id": repoId,
                "actor": actor,
                "operation": operation,
                "access_sha": access.Sha
            }

            if !Output.Sink.Enabled {
                let donor = args.Get("donor")
                Output.Sink.Message(
                    switch operation {
                        case "trust": "Trusted " + donor + " for future approved issues."
                        case "untrust": "Removed trust for " + donor + " on future approved issues."
                        case "deny": "Denied " + donor + " access to approved issues."
                        case "restore": "Removed the access denial for " + donor + "."
                        default: "Initialized donor access for " + repo + "."
                    }
                )

                if operation == "init" {
                    Output.Sink.Message(
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
                if member.Actor == actor {
                    index = i
                    trusted = member.Trusted
                    denied = member.Denied
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
                access.Members.Add(Member(actor, trusted, denied))
            }
        }
    }
}
