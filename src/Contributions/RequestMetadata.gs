package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

internal class RequestMetadata {
    shared {
        internal func Comment(request JsonElement) string {
            let parsed = Request(request)

            let action = parsed.Action
            let payload = RequestData.Canonical(request).Replace("`", "\\u0060")
            RequestData.Parse(payload)

            return "/tokate " +
                action +
                "\n\n" +
                "**Pending coordinator review.** Requested by the author of this comment.\n\n" +
                "This request does not grant access or confirm a reservation or publication. " +
                "Check this issue with `tokate status` for the recorded outcome and next action.\n\n" +
                "<details>\n<summary>Coordination data</summary>\n\n```json\n" +
                payload +
                "\n```\n</details>"
        }

        internal func CommentData(body string) JsonElement {
            if Encoding.UTF8.GetByteCount(body) > 9216 || !body.StartsWith("/tokate ", StringComparison.Ordinal) {
                throw CliFailure("invalid_state", "Invalid or oversized coordination comment")
            }

            let text = body.Substring(8)
            if text.TrimStart().StartsWith("{", StringComparison.Ordinal) {
                return RequestData.Parse(text)
            }

            let marker = "\n```json\n"
            let start = body.IndexOf(marker, StringComparison.Ordinal)
            let ending = "\n```\n</details>"

            if start < 0 || !body.EndsWith(ending, StringComparison.Ordinal) {
                throw CliFailure("invalid_state", "Malformed readable coordination request")
            }

            let payload = body.Substring(start + marker.Length, body.Length - start - marker.Length - ending.Length)
            let request = RequestData.Parse(payload)

            if body != Comment(request) {
                throw CliFailure("invalid_state", "Coordination comment differs from its request")
            }

            return request
        }

        internal func Tools(value JsonElement) {
            let items = J.Items(value)

            if value.ValueKind != JsonValueKind.Array || items.Count < 1 || items.Count > 16 {
                throw CliFailure("invalid_state", "Declare 1 to 16 tools, including every tool used")
            }

            for index in 0 ... items.Count {
                let tool = items[index]
                let parsed = ToolDeclaration.Parse(tool)

                for name in[]string{"harness", "provider", "effort"} {
                    let identifier = switch name {
                        case "harness": parsed.Harness
                        case "provider": parsed.Provider
                        default: parsed.Effort
                    }

                    RequestData.Identifier(
                        RequestData.Token(
                            identifier,
                            "Tools row " + (index + 1).ToString() +
                                " needs " +
                                name +
                                " (letters, digits, dot, dash or underscore)"
                        )
                    )
                }

                RequestData.ModelIdentifier(parsed.Model)

                let seconds = parsed.CodingSeconds ?? 0

                if parsed.InvalidCodingTime || seconds < 0 || seconds > 86400 * 365 {
                    throw CliFailure("invalid_state", "Invalid donor-reported coding time")
                }

                if parsed.Usage.ValueKind != JsonValueKind.Undefined && parsed.Usage.ValueKind != JsonValueKind.Null {
                    RequestUsage.Parse(parsed.Usage)
                }
            }
        }

        internal func Correction(value JsonElement, head string, policy JsonElement) {
            let parsed = CorrectionRequestMetadata.Parse(value)

            if System.Text.Encoding.UTF8.GetByteCount(RequestData.Canonical(value)) > 6144 {
                throw CliFailure("invalid_state", "Correction provenance exceeds its byte limit")
            }

            var uuid Guid
            if !Guid.TryParseExact(parsed.Uuid, "D", out uuid) || uuid.ToString("D") != parsed.Uuid ||
                parsed.Head != head ||
                !Regex.IsMatch(parsed.PatchSha256, "^[0-9a-f]{64}$") ||
                parsed.Seconds < 1 ||
                parsed.Seconds > 86400 ||
                parsed.Verification != "tokate-observed-locally-exact-commit" {
                throw CliFailure("invalid_state", "Invalid bounded correction provenance")
            }

            RepositoryIdentity.CommitSha(head)
            RepositoryIdentity.CommitSha(parsed.Tree)

            let tools = parsed.Tools

            if J.Count(tools) > 0 {
                Tools(tools)
            }

            if policy.ValueKind != JsonValueKind.Undefined {
                if parsed.Seconds > Policy.Parse(policy).MaxSeconds {
                    throw CliFailure("invalid_state", "Correction budget exceeds original owner policy")
                }
                CorrectionTools(tools, policy)
            }
        }

        internal func CorrectionTools(tools JsonElement, policy JsonElement, kind string = "Correction") {
            if tools.ValueKind != JsonValueKind.Array {
                throw CliFailure("invalid_state", kind + " tools must be an array; [] declares manual editing")
            }

            if J.Count(tools) > 0 {
                Tools(tools)
                let owner = Policy(J.Write(policy))
                owner.ValidateTools(tools)
            }
        }

        internal func Binding(actor int64, request JsonElement) string {
            RepositoryIdentity.PositiveId(actor)
            let parsed = CoordinatorRequest.Parse(request)

            let binding = map[string, Object?]{
                "actor": actor,
                "expected": parsed.Expected,
                "approval": parsed.Approval,
                "request": request
            }

            return J.Hash(RequestData.Canonical(J.Parse(J.Write(binding))))
        }

        internal func Incomplete(metadata JsonElement) bool {
            let value = J.Get(metadata, "incomplete")
            return Incomplete(value.ValueKind != JsonValueKind.Undefined, value.ValueKind == JsonValueKind.True)
        }

        internal func Incomplete(declared bool, incomplete bool) bool {
            if declared && !incomplete {
                throw CliFailure("invalid_state", "Incomplete work must be declared explicitly")
            }

            return incomplete
        }

        internal func Recorded(state JsonElement, actor int64, request JsonElement) JsonElement {
            let binding = Binding(actor, request)
            let parsed = CoordinatorRequest.Parse(request)
            var result JsonElement

            for old in J.Items(J.Get(state, "outcomes")) {
                if J.Text(old, "uuid") == parsed.Uuid {
                    if J.Text(old, "binding") != binding {
                        throw CliFailure("invalid_state", "UUID replay changed actor or request contents")
                    }

                    if result.ValueKind != JsonValueKind.Undefined {
                        throw CliFailure("invalid_state", "Ambiguous recorded request outcomes")
                    }

                    result = J.Get(old, "outcome")
                    if result.ValueKind != JsonValueKind.Object {
                        throw CliFailure("invalid_state", "Invalid recorded request outcome")
                    }
                }
            }

            return result
        }

        internal func Request(value JsonElement) CoordinatorRequest {
            let parsed = CoordinatorRequest.Parse(value)

            var uuid Guid
            let requestId = parsed.Uuid

            if !Guid.TryParseExact(requestId, "D", out uuid) || uuid.ToString("D") != requestId || !Regex.IsMatch(
                parsed.Approval,
                "^[0-9a-f]{64}$"
            ) {
                throw CliFailure("invalid_state", "Request needs a canonical UUID and approval identity")
            }

            RepositoryIdentity.CommitSha(parsed.Expected)

            let metadata = parsed.Metadata

            if parsed.Action == "claim" || LeaseLifecycle.Transition(parsed.Action) {
                RequestData.Keys(metadata, "")
            } else if parsed.Action == "publish" {
                Publication(metadata)
            } else if parsed.Action == "amend" {
                Amendment(metadata)
            } else {
                throw CliFailure("invalid_state", "Only claim, publish and amend are donor request operations")
            }

            return parsed
        }

        private func Publication(metadata JsonElement) {
            let parsed = PublicationRequestMetadata.Parse(metadata)
            RepositoryIdentity.Repo(parsed.Fork)
            RepositoryIdentity.CommitSha(parsed.Head)

            if !Regex.IsMatch(parsed.Branch, "^tokate/v2-[0-9a-f-]{36}$") ||
                (parsed.SourceKind != "external" && parsed.SourceKind != "tokate") ||
                parsed.Verification != (
                Incomplete(parsed.HasIncomplete, parsed.Incomplete) ? "not-passed": "donor-reported-pass"
            ) {
                throw CliFailure("invalid_state", "Invalid contribution declaration")
            }

            Tools(parsed.Tools)

            if let model = parsed.RequestedModel {
                RequestData.ModelIdentifier(model)
            }

            if let model = parsed.ReportedModel {
                RequestData.ModelIdentifier(model)
            }

            if parsed.HasRequestedModel &&
                (
                parsed.SourceKind != "tokate" || (parsed.RequestedModel ?? "") != ToolDeclaration.Parse(
                    J.Items(parsed.Tools)[0]
                )
                    .Model
            ) {
                throw CliFailure("invalid_state", "Requested model differs from the declared execution")
            }

            ContributionHandoff.Declaration(parsed.Handoff)
            AttemptContinuation.Declaration(metadata)

            if parsed.Correction.ValueKind != JsonValueKind.Undefined {
                if parsed.Incomplete {
                    throw CliFailure("invalid_state", "Incomplete work cannot claim verified correction provenance")
                }

                if parsed.SourceKind != "tokate" {
                    throw CliFailure("invalid_state", "Correction provenance requires managed original work")
                }

                Correction(parsed.Correction, parsed.Head, JsonElement{})
            }

            if parsed.Summary.ValueKind != JsonValueKind.Undefined {
                PublicSummary.Validate(parsed.Summary, parsed.Head)
            }
        }

        private func Amendment(metadata JsonElement) {
            let parsed = AmendmentRequestMetadata.Parse(metadata)
            RepositoryIdentity.Repo(parsed.Fork)
            RepositoryIdentity.CommitSha(parsed.Head)
            RepositoryIdentity.CommitSha(parsed.Previous)

            if parsed.HasBase {
                RepositoryIdentity.CommitSha(parsed.Base)
            }

            if !Regex.IsMatch(parsed.Branch, "^tokate/v2-[0-9a-f-]{36}$") ||
                parsed.Pr < 1 ||
                parsed.Seconds < 1 ||
                parsed.Verification != "donor-reported-pass" {
                throw CliFailure("invalid_state", "Invalid amendment declaration")
            }

            if J.Count(parsed.Tools) > 0 {
                Tools(parsed.Tools)
            }

            if parsed.Summary.ValueKind != JsonValueKind.Undefined {
                PublicSummary.Validate(parsed.Summary, parsed.Head)
            }
        }
    }
}

internal class CoordinatorRequest(
    uuid string,
    expected string,
    approval string,
    action string,
    metadata JsonElement,
    source JsonElement = default(JsonElement)
) {
    private let Source JsonElement = source
    internal let Uuid string = uuid
    internal let Expected string = expected
    internal let Approval string = approval
    internal let Action string = action
    internal let Metadata JsonElement = metadata

    internal func ToJson() string {
        using let bytes = MemoryStream()
        using let writer = Utf8JsonWriter(bytes)
        Write(writer)
        writer.Flush()

        return Encoding.UTF8.GetString(bytes.ToArray())
    }

    internal func Write(writer Utf8JsonWriter) {
        if Source.ValueKind != JsonValueKind.Undefined {
            Source.WriteTo(writer)
            return
        }

        writer.WriteStartObject()
        writer.WriteString("uuid", Uuid)
        writer.WriteString("expected", Expected)
        writer.WriteString("approval", Approval)
        writer.WriteString("action", Action)
        writer.WritePropertyName("metadata")

        if Action == "publish" {
            PublicationRequestMetadata.Parse(Metadata).Write(writer)
        } else if Action == "amend" {
            AmendmentRequestMetadata.Parse(Metadata).Write(writer)
        } else {
            Metadata.WriteTo(writer)
        }

        writer.WriteEndObject()
    }

    shared {
        internal func Parse(value JsonElement) CoordinatorRequest {
            RequestData.Keys(value, "uuid,expected,approval,action,metadata")
            let uuid = JsonFields.String(value, "Coordinator request", "uuid")
            let expected = JsonFields.String(value, "Coordinator request", "expected")
            let approval = JsonFields.String(value, "Coordinator request", "approval")
            let action = JsonFields.String(value, "Coordinator request", "action")
            let metadata = J.Get(value, "metadata")

            if metadata.ValueKind != JsonValueKind.Object {
                throw CliFailure("invalid_state", "Coordinator request: field \"metadata\" is missing or not an object")
            }

            return CoordinatorRequest(uuid, expected, approval, action, metadata, value)
        }
    }
}

internal class PublicationRequestMetadata(value JsonElement, pr int32) {
    private let Source JsonElement = value
    internal let Fork string = JsonFields.String(value, "Publication request metadata", "fork")
    internal let Branch string = JsonFields.String(value, "Publication request metadata", "branch")
    internal let Head string = JsonFields.String(value, "Publication request metadata", "head")
    internal let Pr int32 = pr
    internal let PrValue JsonElement = J.Get(value, "pr")
    internal let SourceKind string = JsonFields.String(value, "Publication request metadata", "source")
    internal let Tools JsonElement = JsonFields.Array(value, "Publication request metadata", "tools")
    internal let Verification string = JsonFields.String(value, "Publication request metadata", "verification")
    internal let Correction JsonElement = J.Get(value, "correction")
    internal let Summary JsonElement = J.Get(value, "summary")
    internal let Attempt string = J.Get(value, "attempt").ValueKind == JsonValueKind.String ?
    JsonFields.String(value, "Publication request metadata", "attempt"): ""
    internal let Predecessor JsonElement = J.Get(value, "predecessor")
    internal let ImportManifestSha256 string = J.Get(value, "import_manifest_sha256")
        .ValueKind == JsonValueKind.String ?
    JsonFields.String(value, "Publication request metadata", "import_manifest_sha256"): ""
    internal let Incomplete bool = J.Get(value, "incomplete").ValueKind == JsonValueKind.True
    internal let HasIncomplete bool = J.Get(value, "incomplete").ValueKind != JsonValueKind.Undefined
    internal let Handoff JsonElement = J.Get(value, "handoff")
    internal let ImportManifestValue JsonElement = J.Get(value, "import_manifest_sha256")
    internal let RequestedModelValue JsonElement = J.Get(value, "requested_model")
    internal let ReportedModelValue JsonElement = J.Get(value, "reported_model")
    internal let HasRequestedModel bool = J.Get(value, "requested_model").ValueKind != JsonValueKind.Undefined
    internal let RequestedModel string? = J.Get(value, "requested_model").ValueKind == JsonValueKind.Undefined || J.Get(
        value,
        "requested_model"
    )
        .ValueKind == JsonValueKind.Null ? nil:
    (
        J.Get(value, "requested_model").ValueKind == JsonValueKind.String ?
        JsonFields.String(value, "Publication request metadata", "requested_model"): ""
    ) as string?
    internal let HasReportedModel bool = J.Get(value, "reported_model").ValueKind != JsonValueKind.Undefined
    internal let ReportedModel string? = J.Get(value, "reported_model").ValueKind == JsonValueKind.Undefined || J.Get(
        value,
        "reported_model"
    )
        .ValueKind == JsonValueKind.Null ? nil:
    (
        J.Get(value, "reported_model").ValueKind == JsonValueKind.String ?
        JsonFields.String(value, "Publication request metadata", "reported_model"): ""
    ) as string?

    internal func Write(writer Utf8JsonWriter) {
        writer.WriteStartObject()

        for field in Source.EnumerateObject() {
            if field.Name == "tools" {
                writer.WritePropertyName(field.Name)
                ToolDeclaration.WriteAll(writer, field.Value)
            } else if field.Name == "correction" {
                writer.WritePropertyName(field.Name)
                CorrectionRequestMetadata.Parse(field.Value).Write(writer)
            } else if field.Name == "handoff" {
                writer.WritePropertyName(field.Name)
                HandoffRequestMetadata.Parse(field.Value).Write(writer)
            } else if field.Name == "predecessor" {
                writer.WritePropertyName(field.Name)
                ContinuationPredecessor.Parse(field.Value).Write(writer)
            } else {
                field.WriteTo(writer)
            }
        }

        writer.WriteEndObject()
    }

    internal func WithPr(pr int32) JsonElement {
        using let bytes = MemoryStream()
        using let writer = Utf8JsonWriter(bytes)
        writer.WriteStartObject()
        var written = false

        for field in Source.EnumerateObject() {
            if field.Name == "pr" {
                writer.WriteNumber("pr", pr)
                written = true
            } else {
                field.WriteTo(writer)
            }
        }

        if !written {
            writer.WriteNumber("pr", pr)
        }

        writer.WriteEndObject()
        writer.Flush()
        bytes.Position = 0

        return J.Parse(bytes)
    }

    shared {
        internal func Parse(value JsonElement) PublicationRequestMetadata {
            RequestData.Keys(
                value,
                "fork,branch,head,pr,source,tools,verification,correction,summary,attempt,predecessor,import_manifest_sha256,incomplete,handoff,requested_model,reported_model"
            )

            let number = J.Get(value, "pr")
            var pr int32

            if number.ValueKind != JsonValueKind.Number || !number.TryGetInt32(out pr) {
                pr = 0
            }

            return PublicationRequestMetadata(value, pr)
        }
    }
}

internal class AmendmentRequestMetadata(value JsonElement) {
    private let Source JsonElement = value
    internal let Fork string = JsonFields.String(value, "Amendment request metadata", "fork")
    internal let Branch string = JsonFields.String(value, "Amendment request metadata", "branch")
    internal let Previous string = JsonFields.String(value, "Amendment request metadata", "previous")
    internal let Head string = JsonFields.String(value, "Amendment request metadata", "head")
    internal let Pr int32 = JsonFields.Int32(value, "Amendment request metadata", "pr")
    internal let Seconds int32 = JsonFields.Int32(value, "Amendment request metadata", "seconds")
    internal let Tools JsonElement = JsonFields.Array(value, "Amendment request metadata", "tools")
    internal let Verification string = JsonFields.String(value, "Amendment request metadata", "verification")
    internal let Base string = J.Get(value, "base").ValueKind == JsonValueKind.String ?
    JsonFields.String(value, "Amendment request metadata", "base"): ""
    internal let HasBase bool = J.Get(value, "base").ValueKind != JsonValueKind.Undefined
    internal let Summary JsonElement = J.Get(value, "summary")
    internal let Attempt string = J.Get(value, "attempt").ValueKind == JsonValueKind.String ?
    JsonFields.String(value, "Amendment request metadata", "attempt"): ""

    internal func Write(writer Utf8JsonWriter) {
        writer.WriteStartObject()

        for field in Source.EnumerateObject() {
            if field.Name == "tools" {
                writer.WritePropertyName(field.Name)
                ToolDeclaration.WriteAll(writer, field.Value)
            } else {
                field.WriteTo(writer)
            }
        }

        writer.WriteEndObject()
    }

    shared {
        internal func Parse(value JsonElement) AmendmentRequestMetadata {
            RequestData.Keys(value, "fork,branch,previous,head,pr,seconds,tools,verification,base,summary,attempt")

            return AmendmentRequestMetadata(value)
        }
    }
}

internal class CorrectionRequestMetadata(value JsonElement) {
    private let Source JsonElement = value
    internal let Uuid string = JsonFields.String(value, "Correction request metadata", "uuid")
    internal let Head string = JsonFields.String(value, "Correction request metadata", "head")
    internal let Tree string = JsonFields.String(value, "Correction request metadata", "tree")
    internal let PatchSha256 string = JsonFields.String(value, "Correction request metadata", "patch_sha256")
    internal let Seconds int32 = JsonFields.Int32(value, "Correction request metadata", "seconds")
    internal let Tools JsonElement = JsonFields.Array(value, "Correction request metadata", "tools")
    internal let Verification string = JsonFields.String(value, "Correction request metadata", "verification")

    internal func Write(writer Utf8JsonWriter) {
        writer.WriteStartObject()

        for field in Source.EnumerateObject() {
            if field.Name == "tools" {
                writer.WritePropertyName(field.Name)
                ToolDeclaration.WriteAll(writer, field.Value)
            } else {
                field.WriteTo(writer)
            }
        }

        writer.WriteEndObject()
    }

    shared {
        internal func Parse(value JsonElement) CorrectionRequestMetadata {
            RequestData.Keys(value, "uuid,head,tree,patch_sha256,seconds,tools,verification")

            return CorrectionRequestMetadata(value)
        }
    }
}
