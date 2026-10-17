package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text
import System.Text.Json

internal class CoordinationState {
    internal var Sha string = ""
    internal var Version int64 = StateVersion
    internal var Repo string = ""
    internal var Issue int32
    internal var Approval OwnerApproval.Record?
    internal var ApprovalId string = ""
    internal var Revoked bool
    internal var RevocationValid bool
    internal var Identity IdentityRecord?
    internal var PublicationRevision string = ""
    internal var Lease LeaseRecord?
    internal var Contribution PublicationRecord?
    internal var Amendments List[PublicationRecord] = List[PublicationRecord]()
    internal var Outcomes List[ReplayRecord] = List[ReplayRecord]()
    private var Source JsonElement
    private let Order List[string] = List[string]()
    private let Changed HashSet[string] = HashSet[string](StringComparer.Ordinal)

    internal prop ContributionPresent bool -> Order.Contains("contribution")

    internal class IdentityRecord {
        internal var Id string = ""
        internal var Actor int64
        internal var ActorJson JsonElement
        internal var Revision string = ""
        internal var Predecessor IdentityRecord?
        private var Source JsonElement

        internal func Value() JsonElement {
            if Source.ValueKind != JsonValueKind.Undefined {
                return Source
            }

            using let bytes = MemoryStream()
            using let writer = Utf8JsonWriter(bytes)
            Write(writer)
            writer.Flush()

            return J.Parse(Encoding.UTF8.GetString(bytes.ToArray()))
        }

        internal func Write(writer Utf8JsonWriter) {
            if Source.ValueKind != JsonValueKind.Undefined {
                Source.WriteTo(writer)
                return
            }

            writer.WriteStartObject()
            if Revision != "" {
                writer.WriteString("revision", Revision)
            }
            writer.WriteString("id", Id)
            writer.WriteNumber("actor", Actor)
            if let predecessor = Predecessor {
                writer.WritePropertyName("predecessor")
                predecessor.Write(writer)
            }
            writer.WriteEndObject()
        }

        shared {
            internal func Parse(value JsonElement, predecessor bool = false) IdentityRecord? {
                if value.ValueKind == JsonValueKind.Undefined || value.ValueKind == JsonValueKind.Null {
                    return nil
                }

                let result = IdentityRecord{
                    Id: J.Text(value, "id"),
                    Actor: OptionalNumber(value, "actor") ?? 0,
                    ActorJson: J.Get(value, "actor"),
                    Revision: predecessor ? J.Text(value, "revision"): "",
                    Source: value
                }
                if !predecessor {
                    result.Predecessor = Parse(J.Get(value, "predecessor"), true)
                }

                return result
            }
        }
    }

    internal class LeaseRecord {
        internal var Reservation string = ""
        internal var Base string = ""
        internal var Lease string = ""
        internal var Donor string = ""
        internal var Actor int64
        internal var ActorJson JsonElement
        internal var Created int64
        internal var Status string = ""
        internal var Attempt string = ""
        private var HasLease bool
        private var HasStatus bool
        private var HasAttempt bool
        private var Source JsonElement
        private var Updated bool
        private var LifecycleChanged bool
        private var ExpiresValue int64?

        internal prop Expires int64 {
            get -> ExpiresValue ?? throw CliFailure("invalid_state", "Invalid coordination timestamp")
            set -> ExpiresValue = value
        }

        internal func Value() JsonElement {
            if Source.ValueKind != JsonValueKind.Undefined && !Updated {
                return Source
            }

            using let bytes = MemoryStream()
            using let writer = Utf8JsonWriter(bytes)
            Write(writer)
            writer.Flush()

            return J.Parse(Encoding.UTF8.GetString(bytes.ToArray()))
        }

        internal func Update(donor string, expires int64, status string, attempt string, lifecycleChanged bool) {
            Donor = donor
            Expires = expires
            Status = status
            Attempt = attempt
            Updated = true
            LifecycleChanged = lifecycleChanged
        }

        internal func Write(writer Utf8JsonWriter) {
            if Source.ValueKind == JsonValueKind.Object {
                writer.WriteStartObject()
                for field in Source.EnumerateObject() {
                    writer.WritePropertyName(field.Name)
                    if Updated && field.Name == "donor" {
                        writer.WriteStringValue(Donor)
                    } else if Updated && field.Name == "expires" {
                        writer.WriteNumberValue(Expires)
                    } else if Updated && LifecycleChanged && field.Name == "status" {
                        writer.WriteStringValue(Status)
                    } else if Updated && LifecycleChanged && field.Name == "attempt" {
                        writer.WriteStringValue(Attempt)
                    } else {
                        field.Value.WriteTo(writer)
                    }
                }
                if Updated && LifecycleChanged && !HasAttempt {
                    writer.WriteString("attempt", Attempt)
                }
                writer.WriteEndObject()
                return
            }

            writer.WriteStartObject()
            writer.WriteString("reservation", Reservation)
            writer.WriteString("base", Base)
            writer.WriteString("lease", Lease)
            writer.WriteString("donor", Donor)
            writer.WriteNumber("actor", Actor)
            writer.WriteNumber("created", Created)
            writer.WriteNumber("expires", Expires)
            writer.WriteString("status", Status)
            writer.WriteString("attempt", Attempt)
            writer.WriteEndObject()
        }

        internal func Display() Dictionary[string, Object?] {
            let fields = map[string, Object?]{"reservation": Reservation}
            if Source.ValueKind == JsonValueKind.Undefined || HasLease {
                fields["lease"] = Lease
            }
            fields["donor"] = Donor
            fields["actor"] = Actor
            fields["created"] = Created
            fields["expires"] = Expires
            if Source.ValueKind == JsonValueKind.Undefined || HasStatus {
                fields["status"] = Status
            }
            if Source.ValueKind == JsonValueKind.Undefined || HasAttempt {
                fields["attempt"] = Attempt
            }

            return fields
        }

        shared {
            internal func Parse(value JsonElement) LeaseRecord? {
                if value.ValueKind == JsonValueKind.Undefined || value.ValueKind == JsonValueKind.Null {
                    return nil
                }

                return LeaseRecord{
                    Reservation: J.Text(value, "reservation"),
                    Base: J.Text(value, "base"),
                    Lease: J.Text(value, "lease"),
                    Donor: J.Text(value, "donor"),
                    Actor: OptionalNumber(value, "actor") ?? 0,
                    ActorJson: J.Get(value, "actor"),
                    Created: OptionalNumber(value, "created") ?? 0,
                    ExpiresValue: OptionalNumber(value, "expires"),
                    Status: J.Text(value, "status"),
                    Attempt: J.Text(value, "attempt"),
                    HasLease: J.Get(value, "lease").ValueKind == JsonValueKind.String,
                    HasStatus: J.Get(value, "status").ValueKind == JsonValueKind.String,
                    HasAttempt: J.Get(value, "attempt").ValueKind == JsonValueKind.String,
                    Source: value
                }
            }
        }
    }

    internal class ResultRecord {
        internal var Pr int32
        internal var PrJson JsonElement
        internal var Url string = ""
        internal var Head string = ""
        internal var Reservation string = ""
        internal var Lease LeaseRecord?
        private var Source JsonElement
        private var Parsed bool

        internal func Value() JsonElement {
            if Parsed {
                return Source
            }

            using let bytes = MemoryStream()
            using let writer = Utf8JsonWriter(bytes)
            Write(writer)
            writer.Flush()

            return J.Parse(Encoding.UTF8.GetString(bytes.ToArray()))
        }

        internal func Write(writer Utf8JsonWriter) {
            if Parsed {
                Source.WriteTo(writer)
                return
            }
            if let lease = Lease {
                lease.Write(writer)
                return
            }

            writer.WriteStartObject()
            writer.WriteNumber("pr", Pr)
            writer.WriteString("url", Url)
            writer.WriteString("head", Head)
            writer.WriteString("reservation", Reservation)
            writer.WriteEndObject()
        }

        internal func Display() Dictionary[string, Object?] -> Pr == 0 ? map[string, Object?]{}:
        map[string, Object?]{"pr": Pr, "url": Url, "head": Head, "reservation": Reservation}

        shared {
            internal func Parse(value JsonElement, publication bool = false) ResultRecord {
                let result = ResultRecord{Source: value, Parsed: true}

                if publication || J.Get(value, "pr").ValueKind != JsonValueKind.Undefined {
                    result.Pr = J.Number(value, "pr")
                    result.PrJson = J.Get(value, "pr")
                    result.Url = J.Text(value, "url")
                    result.Head = J.Text(value, "head")
                    result.Reservation = J.Text(value, "reservation")
                } else if J.Get(value, "reservation").ValueKind != JsonValueKind.Undefined {
                    result.Lease = LeaseRecord.Parse(value)
                    result.Reservation = result.Lease?.Reservation ?? ""
                }

                return result
            }
        }
    }

    internal class PublicationRecord {
        internal var Request string = ""
        internal var Expected string = ""
        internal var Actor int64
        internal var ActorJson JsonElement
        internal var Donor string = ""
        internal var Metadata JsonElement
        internal var Outcome ResultRecord
        internal var Previous string = ""
        internal var Head string = ""
        internal var Seconds int32
        internal var Tools JsonElement
        internal var Attempt string = ""
        internal var Summary JsonElement
        internal var Base string = ""
        internal var HasBase bool
        internal var IsAmendment bool
        private var Source JsonElement

        internal func Value() JsonElement {
            if Source.ValueKind != JsonValueKind.Undefined {
                return Source
            }

            using let bytes = MemoryStream()
            using let writer = Utf8JsonWriter(bytes)
            Write(writer)
            writer.Flush()

            return J.Parse(Encoding.UTF8.GetString(bytes.ToArray()))
        }

        internal func Write(writer Utf8JsonWriter) {
            if Source.ValueKind != JsonValueKind.Undefined {
                Source.WriteTo(writer)
                return
            }

            writer.WriteStartObject()
            writer.WriteString("request", Request)
            writer.WriteString("expected", Expected)
            if IsAmendment {
                writer.WriteString("previous", Previous)
                writer.WriteString("head", Head)
                writer.WriteNumber("seconds", Seconds)
                writer.WritePropertyName("tools")
                Tools.WriteTo(writer)
            } else {
                writer.WritePropertyName("metadata")
                Metadata.WriteTo(writer)
            }
            writer.WriteNumber("actor", Actor)
            writer.WriteString("donor", Donor)
            if IsAmendment {
                writer.WriteString("attempt", Attempt)
            }
            writer.WritePropertyName("outcome")
            Outcome.Write(writer)
            writer.WriteString("verification_provenance", VerificationProvenance)
            if Summary.ValueKind != JsonValueKind.Undefined {
                writer.WritePropertyName("summary")
                Summary.WriteTo(writer)
            }
            if HasBase {
                writer.WriteString("base", Base)
            }
            writer.WriteEndObject()
        }

        shared {
            private const VerificationProvenance string = "donor-reported; exact-commit owner CI required"

            internal func Parse(value JsonElement, amendment bool = false) PublicationRecord? {
                if value.ValueKind == JsonValueKind.Undefined || value.ValueKind == JsonValueKind.Null {
                    return nil
                }

                let result = PublicationRecord{
                    Request: J.Text(value, "request"),
                    Expected: J.Text(value, "expected"),
                    Actor: OptionalNumber(value, "actor") ?? 0,
                    ActorJson: J.Get(value, "actor"),
                    Donor: J.Text(value, "donor"),
                    Outcome: ResultRecord.Parse(J.Get(value, "outcome"), true),
                    Attempt: J.Text(value, "attempt"),
                    Summary: J.Get(value, "summary"),
                    Base: J.Text(value, "base"),
                    HasBase: J.Get(value, "base").ValueKind != JsonValueKind.Undefined,
                    IsAmendment: amendment,
                    Source: value
                }

                if amendment {
                    result.Previous = J.Text(value, "previous")
                    result.Head = J.Text(value, "head")
                    result.Seconds = J.Number(value, "seconds")
                    result.Tools = J.Get(value, "tools")
                } else {
                    result.Metadata = J.Get(value, "metadata")
                }

                return result
            }
        }
    }

    internal class ReplayRecord {
        internal var Uuid string = ""
        internal var Binding string = ""
        internal var Outcome ResultRecord
        private var Source JsonElement

        internal func Write(writer Utf8JsonWriter) {
            if Source.ValueKind != JsonValueKind.Undefined {
                Source.WriteTo(writer)
                return
            }

            writer.WriteStartObject()
            writer.WriteString("uuid", Uuid)
            writer.WriteString("binding", Binding)
            writer.WritePropertyName("outcome")
            Outcome.Write(writer)
            writer.WriteEndObject()
        }

        shared {
            internal func Parse(value JsonElement) ReplayRecord -> ReplayRecord{
                Uuid: J.Text(value, "uuid"),
                Binding: J.Text(value, "binding"),
                Outcome: ResultRecord.Parse(J.Get(value, "outcome")),
                Source: value
            }
        }
    }

    internal func Include(name string) {
        Changed.Add(name)
        if name == "revoked" {
            RevocationValid = true
        }
        if !Order.Contains(name) {
            Order.Add(name)
        }
    }

    internal func Current() PublicationRecord? -> Amendments.Count == 0 ? Contribution: Amendments[Amendments.Count - 1]

    internal func Head() string -> Current()?.Outcome.Head ?? ""

    internal func Value() JsonElement -> J.Parse(ToText())

    internal func ToText() string {
        using let bytes = MemoryStream()
        using let writer = Utf8JsonWriter(bytes)

        writer.WriteStartObject()
        for name in Order {
            writer.WritePropertyName(name)
            WriteField(writer, name)
        }
        writer.WriteEndObject()
        writer.Flush()

        return Encoding.UTF8.GetString(bytes.ToArray())
    }

    private func WriteField(writer Utf8JsonWriter, name string) {
        if Source.ValueKind == JsonValueKind.Object && !Changed.Contains(name) {
            Source.GetProperty(name).WriteTo(writer)
            return
        }

        switch name {
            case "version" {
                writer.WriteNumberValue(Version)
            }
            case "repo" {
                writer.WriteStringValue(Repo)
            }
            case "issue" {
                writer.WriteNumberValue(Issue)
            }
            case "approval" {
                if let approval = Approval {
                    approval.Write(writer)
                } else {
                    writer.WriteNullValue()
                }
            }
            case "approval_id" {
                writer.WriteStringValue(ApprovalId)
            }
            case "revoked" {
                writer.WriteBooleanValue(Revoked)
            }
            case "identity" {
                if let identity = Identity {
                    identity.Write(writer)
                } else {
                    writer.WriteNullValue()
                }
            }
            case "publication_revision" {
                if PublicationRevision == "" {
                    writer.WriteNullValue()
                } else {
                    writer.WriteStringValue(PublicationRevision)
                }
            }
            case "reservation" {
                if let lease = Lease {
                    lease.Write(writer)
                } else {
                    writer.WriteNullValue()
                }
            }
            case "contribution" {
                if let contribution = Contribution {
                    contribution.Write(writer)
                } else {
                    writer.WriteNullValue()
                }
            }
            case "amendments" {
                writer.WriteStartArray()
                for entry in Amendments {
                    entry.Write(writer)
                }
                writer.WriteEndArray()
            }
            case "outcomes" {
                writer.WriteStartArray()
                for entry in Outcomes {
                    entry.Write(writer)
                }
                writer.WriteEndArray()
            }
            default {
                Source.GetProperty(name).WriteTo(writer)
            }
        }
    }

    internal func ApprovalWarning(repo string) string {
        let reservation = Lease
        let contribution = Contribution
        let now = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
        let active = reservation != nil && reservation.Status != "released" && reservation.Expires > now
        var warning = active ? "Re-approval ends the active reservation's authority.": ""

        if contribution != nil {
            let pr = repo + "#" + contribution.Outcome.Pr.ToString()
            warning += (active ? " ": "") + "Re-approval ends the authority of published PR " + pr + "."
        }

        return warning
    }

    internal func Write(repo string, issue int32, expected string, expires int64 = 0) {
        let tree = GitHub.Api(
            "repos/" + repo + "/git/trees",
            map[string, Object?]{
                "tree": []Object{
                    map[string, Object?]{"path": "state.json", "mode": "100644", "type": "blob", "content": ToText()}
                }
            },
            expires: expires
        )

        let commit = GitHub.Api(
            "repos/" + repo + "/git/commits",
            GitHub.AutomationCommit(
                "Tokate coordination #" + issue.ToString(),
                J.Text(tree, "sha"),
                []string{expected},
                GitHub.Bot()
            ),
            expires: expires
        )

        let next = J.Text(commit, "sha")

        if Sha == "" {
            GitHub.Api(
                "repos/" + repo + "/git/refs",
                map[string, Object?]{"ref": GitHub.HeadsRefPrefix + Ref(issue), "sha": next},
                expires: expires
            )
        } else {
            for attempt in 0 ... 2 {
                try {
                    GitHub.Api(
                        "repos/" + repo + "/git/" + GitHub.HeadsRefPrefix + Ref(issue),
                        map[string, Object?]{"sha": next, "force": false},
                        "PATCH",
                        expires: expires
                    )
                    break
                } catch (error CliFailure) {
                    if attempt > 0 {
                        throw CliFailure(
                            error.Code,
                            error.Message.Replace(
                                "No automatic retry was made.",
                                "One conditional ref retry was made after re-reading current state."
                            ),
                            httpStatus: error.HttpStatus
                        )
                    }

                    if error.HttpStatus < 500 || error.HttpStatus > 599 {
                        throw error
                    }

                    ApiTransport.Settle()
                    let current = Load(repo, issue)

                    if current.Sha == next {
                        break
                    }

                    if current.Sha != expected {
                        throw error
                    }
                }
            }
        }

        Sha = next
    }

    internal func Check(repo string, issue int32, donor string, actor JsonElement) JsonElement {
        let record = CheckApproval(repo, issue)
        let approval = J.Get(record, "approval")

        AccessState.Check(repo, issue, approval, actor, J.Get(record, "policy"))

        return record
    }

    internal func CheckApproval(repo string, issue int32, quiet bool = false) JsonElement {
        let approval = Approval?.Value() ?? default(JsonElement)
        var task JsonElement
        try {
            task = GitHub.Issue(repo, issue)
        } catch (error CliFailure) when error.Code == "invalid_state" {
            throw CliFailure(
                "invalid_state",
                error.Message + " Owner: reopen the issue before continuing this contribution.",
                []string{"gh", "issue", "reopen", issue.ToString(), "--repo", repo}
            )
        }
        if approval.ValueKind == JsonValueKind.Undefined || approval.ValueKind == JsonValueKind.Null {
            throw ApprovalFailure(repo, issue, "Issue is not approved.")
        }
        let approved = AccessState.Task(approval)

        if Revoked || !GitHub.HasLabel(task) {
            throw ApprovalFailure(
                repo,
                issue,
                "Approval revoked or task changed. Issue approval is revoked or its approval label is missing."
            )
        }

        if approved.IssueHash != GitHub.Fingerprint(task) {
            throw ApprovalFailure(repo, issue, "Approval revoked or task changed. Issue text changed since approval.")
        }

        let configuration = ApprovalBase.Check(repo, approval, quiet)
        return J.Parse(
            J.Write(
                map[string, Object?]{
                    "approval": approval,
                    "base": Lease?.Base ?? "",
                    "policy": configuration.Item1.Value,
                    "template": configuration.Item2,
                    "issue": task
                }
            )
        )
    }

    internal func Reservation(actor JsonElement) {
        LeaseLifecycle.Owner(this, actor, true)
    }

    shared {
        private const StateVersion int64 = 2
        private const StateByteLimit int32 = 1024 * 1024
        private const InvalidStateMessage string = "Invalid version-2 coordination state"

        internal func ApprovalFailure(repo string, issue int32, reason string) CliFailure {
            let task = repo + "#" + issue.ToString()
            return CliFailure(
                "stale_approval",
                reason + " The owner must run: tokate approve " + task,
                []string{"tokate", "approve", task}
            )
        }

        internal func Ref(issue int32) string -> GitHub.ContributionStateRefPrefix + issue.ToString()

        internal func Load(repo string, issue int32, missing bool = false) CoordinationState {
            let result = CoordinationState()
            let reference = GitHub.Api("repos/" + repo + "/git/ref/heads/" + Ref(issue), missing: true)

            if reference.ValueKind == JsonValueKind.Undefined {
                if !missing {
                    throw ApprovalFailure(repo, issue, "Issue is not approved. Approval record is missing.")
                }
                return result
            }

            return At(repo, issue, J.Text(J.Get(reference, "object"), "sha"))
        }

        internal func At(repo string, issue int32, sha string) CoordinationState {
            let revision = RepositoryIdentity.CommitSha(sha)
            let value = RequestData.Parse(GitHub.FileAt(repo, "state.json", revision), StateByteLimit)
            let result = Parse(value, repo, issue)
            result.Sha = revision

            return result
        }

        internal func Approve(repo string, issue int32, approval OwnerApproval.Record) {
            let state = Load(repo, issue, true)
            let warning = state.ApprovalWarning(repo)
            if warning != "" {
                Output.Sink.Message(warning, error: true)
            }

            let approved = approval.Value()
            let expected = state.Sha == "" ? approval.Base: state.Sha

            state.Version = StateVersion
            state.Repo = repo
            state.Issue = issue
            state.Approval = approval
            state.ApprovalId = J.Hash(RequestData.Canonical(approved))
            state.Revoked = false
            state.Identity = nil
            state.PublicationRevision = ""
            state.Lease = nil
            state.Contribution = nil
            state.Amendments.Clear()

            for name in[]string{
                "version",
                "repo",
                "issue",
                "approval",
                "approval_id",
                "revoked",
                "identity",
                "publication_revision",
                "reservation",
                "contribution",
                "amendments"
            } {
                state.Include(name)
            }

            if !state.Order.Contains("outcomes") {
                state.Include("outcomes")
            }

            state.Write(repo, issue, expected)
        }

        private func OptionalNumber(value JsonElement, field string) int64? {
            let item = J.Get(value, field)
            var result int64

            return item.ValueKind == JsonValueKind.Number && item.TryGetInt64(out result) ? result: nil
        }

        internal func Parse(value JsonElement, repo string = "", issue int32 = 0) CoordinationState {
            let version = J.Number(value, "version")
            if version != StateVersion {
                throw CliFailure("invalid_state", InvalidStateMessage)
            }

            let result = CoordinationState{
                Version: version,
                Repo: J.Text(value, "repo"),
                Issue: J.Number(value, "issue"),
                Source: value
            }

            if repo != "" && (!RepositoryIdentity.SameRepo(result.Repo, repo) || result.Issue != issue) {
                throw CliFailure("invalid_state", InvalidStateMessage)
            }

            result.ApprovalId = J.Text(value, "approval_id")
            result.Revoked = J.Bool(value, "revoked")
            result.RevocationValid = J.Get(value, "revoked").ValueKind == JsonValueKind.True || J.Get(value, "revoked")
                .ValueKind == JsonValueKind.False
            result.PublicationRevision = J.Text(value, "publication_revision")
            result.Identity = IdentityRecord.Parse(J.Get(value, "identity"))
            result.Lease = LeaseRecord.Parse(J.Get(value, "reservation"))
            result.Contribution = PublicationRecord.Parse(J.Get(value, "contribution"))

            let approval = J.Get(value, "approval")
            if approval.ValueKind != JsonValueKind.Undefined && approval.ValueKind != JsonValueKind.Null {
                result.Approval = OwnerApproval.Record.Parse(approval)
            }

            for field in value.EnumerateObject() {
                result.Order.Add(field.Name)
            }

            let amendments = J.Get(value, "amendments")
            if amendments.ValueKind == JsonValueKind.Array {
                for entry in amendments.EnumerateArray() {
                    if let amendment = PublicationRecord.Parse(entry, true) {
                        result.Amendments.Add(amendment)
                    }
                }
            }

            let outcomes = J.Get(value, "outcomes")
            if outcomes.ValueKind == JsonValueKind.Array {
                for entry in outcomes.EnumerateArray() {
                    result.Outcomes.Add(ReplayRecord.Parse(entry))
                }
            }

            return result
        }
    }
}
