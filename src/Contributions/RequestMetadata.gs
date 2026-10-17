package Tokate

import System
import System.Collections.Generic
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

internal class RequestMetadata {
    shared {
        internal func Comment(request JsonElement) string {
            Request(request)

            let action = J.Text(request, "action")
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
                RequestData.Keys(tool, "harness,provider,model,effort,usage,coding_seconds")

                for name in[]string{"harness", "provider", "effort"} {
                    RequestData.Identifier(
                        RequestData.Token(
                            J.Text(tool, name),
                            "Tools row " + (index + 1).ToString() +
                                " needs " +
                                name +
                                " (letters, digits, dot, dash or underscore)"
                        )
                    )
                }

                RequestData.ModelIdentifier(J.Text(tool, "model"))
                let number = J.Get(tool, "coding_seconds")
                var seconds int64

                if number.ValueKind != JsonValueKind.Undefined &&
                    number.ValueKind != JsonValueKind.Null &&
                    (
                    number.ValueKind != JsonValueKind.Number || !number.TryGetInt64(out seconds) ||
                        seconds < 0 ||
                        seconds > 86400 * 365
                ) {
                    throw CliFailure("invalid_state", "Invalid donor-reported coding time")
                }

                let usage = J.Get(tool, "usage")
                if usage.ValueKind != JsonValueKind.Undefined && usage.ValueKind != JsonValueKind.Null {
                    RequestData.Keys(usage, "input_tokens,cached_input_tokens,output_tokens")

                    for field in usage.EnumerateObject() {
                        var count int64
                        if field.Value.ValueKind != JsonValueKind.Number || !field.Value.TryGetInt64(out count) ||
                            count < 0 {
                            throw CliFailure("invalid_state", "Usage must be a nonnegative donor-reported count")
                        }
                    }
                }
            }
        }

        internal func Correction(value JsonElement, head string, policy JsonElement) {
            RequestData.Keys(value, "uuid,head,tree,patch_sha256,seconds,tools,verification")

            if System.Text.Encoding.UTF8.GetByteCount(RequestData.Canonical(value)) > 6144 {
                throw CliFailure("invalid_state", "Correction provenance exceeds its byte limit")
            }

            var uuid Guid
            if !Guid.TryParseExact(J.Text(value, "uuid"), "D", out uuid) || uuid.ToString("D") != J.Text(
                value,
                "uuid"
            ) ||
                J.Text(value, "head") != head || !Regex.IsMatch(J.Text(value, "patch_sha256"), "^[0-9a-f]{64}$") ||
                J.Number(value, "seconds") < 1 || J.Number(value, "seconds") > 86400 || J.Text(
                value,
                "verification"
            ) != "tokate-observed-locally-exact-commit" {
                throw CliFailure("invalid_state", "Invalid bounded correction provenance")
            }

            RepositoryIdentity.CommitSha(head)
            RepositoryIdentity.CommitSha(J.Text(value, "tree"))

            let tools = J.Get(value, "tools")

            if tools.ValueKind != JsonValueKind.Array {
                throw CliFailure("invalid_state", "Correction tools must be an array; [] declares manual editing")
            }

            if J.Count(tools) > 0 {
                Tools(tools)
            }

            if policy.ValueKind != JsonValueKind.Undefined {
                if J.Number(value, "seconds") > Policy.Parse(policy).MaxSeconds {
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

        internal func Binding(actor JsonElement, request JsonElement) string {
            RepositoryIdentity.PositiveId(actor)

            let binding = map[string, Object?]{
                "actor": actor,
                "expected": J.Text(request, "expected"),
                "approval": J.Text(request, "approval"),
                "request": request
            }

            return J.Hash(RequestData.Canonical(J.Parse(J.Write(binding))))
        }

        internal func Incomplete(metadata JsonElement) bool {
            let value = J.Get(metadata, "incomplete")
            if value.ValueKind != JsonValueKind.Undefined && value.ValueKind != JsonValueKind.True {
                throw CliFailure("invalid_state", "Incomplete work must be declared explicitly")
            }

            return value.ValueKind == JsonValueKind.True
        }

        internal func Recorded(
            state CoordinationState,
            actor JsonElement,
            request JsonElement
        ) CoordinationState.ResultRecord? {
            let binding = Binding(actor, request)
            var result CoordinationState.ResultRecord? = nil

            for old in state.Outcomes {
                if old.Uuid == J.Text(request, "uuid") {
                    if old.Binding != binding {
                        throw CliFailure("invalid_state", "UUID replay changed actor or request contents")
                    }

                    if result != nil {
                        throw CliFailure("invalid_state", "Ambiguous recorded request outcomes")
                    }

                    result = old.Outcome
                    if result.Value().ValueKind != JsonValueKind.Object {
                        throw CliFailure("invalid_state", "Invalid recorded request outcome")
                    }
                }
            }

            return result
        }

        internal func Request(value JsonElement) {
            RequestData.Keys(value, "uuid,expected,approval,action,metadata")

            var uuid Guid
            let requestId = J.Text(value, "uuid")

            if !Guid.TryParseExact(requestId, "D", out uuid) || uuid.ToString("D") != requestId || !Regex.IsMatch(
                J.Text(value, "approval"),
                "^[0-9a-f]{64}$"
            ) {
                throw CliFailure("invalid_state", "Request needs a canonical UUID and approval identity")
            }

            RepositoryIdentity.CommitSha(J.Text(value, "expected"))

            let metadata = J.Get(value, "metadata")

            if J.Text(value, "action") == "claim" || LeaseLifecycle.Transition(J.Text(value, "action")) {
                RequestData.Keys(metadata, "")
            } else if J.Text(value, "action") == "publish" {
                RequestData.Keys(
                    metadata,
                    "fork,branch,head,pr,source,tools,verification,correction,summary,attempt,predecessor,import_manifest_sha256,incomplete,handoff,requested_model,reported_model"
                )
                RepositoryIdentity.Repo(J.Text(metadata, "fork"))
                RepositoryIdentity.CommitSha(J.Text(metadata, "head"))

                if !Regex.IsMatch(J.Text(metadata, "branch"), "^tokate/v2-[0-9a-f-]{36}$") ||
                    (J.Text(metadata, "source") != "external" && J.Text(metadata, "source") != "tokate") ||
                    J.Text(metadata, "verification") != (Incomplete(metadata) ? "not-passed": "donor-reported-pass") {
                    throw CliFailure("invalid_state", "Invalid contribution declaration")
                }

                Tools(J.Get(metadata, "tools"))
                for key in[]string{"requested_model", "reported_model"} {
                    let model = J.Get(metadata, key)
                    if model.ValueKind != JsonValueKind.Undefined && model.ValueKind != JsonValueKind.Null {
                        RequestData.ModelIdentifier(J.Text(metadata, key))
                    }
                }

                if J.Get(metadata, "requested_model")
                    .ValueKind != JsonValueKind.Undefined &&
                    (
                    J.Text(metadata, "source") != "tokate" || J.Text(metadata, "requested_model") != J.Text(
                        J.Items(J.Get(metadata, "tools"))[0],
                        "model"
                    )
                ) {
                    throw CliFailure("invalid_state", "Requested model differs from the declared execution")
                }

                ContributionHandoff.Declaration(J.Get(metadata, "handoff"))
                AttemptContinuation.Declaration(metadata)

                let correction = J.Get(metadata, "correction")

                if correction.ValueKind != JsonValueKind.Undefined {
                    if Incomplete(metadata) {
                        throw CliFailure("invalid_state", "Incomplete work cannot claim verified correction provenance")
                    }

                    if J.Text(metadata, "source") != "tokate" {
                        throw CliFailure("invalid_state", "Correction provenance requires managed original work")
                    }
                    Correction(correction, J.Text(metadata, "head"), JsonElement{})
                }
            } else if J.Text(value, "action") == "amend" {
                RequestData.Keys(
                    metadata,
                    "fork,branch,previous,head,pr,seconds,tools,verification,base,summary,attempt"
                )
                RepositoryIdentity.Repo(J.Text(metadata, "fork"))
                RepositoryIdentity.CommitSha(J.Text(metadata, "head"))
                RepositoryIdentity.CommitSha(J.Text(metadata, "previous"))

                if J.Get(metadata, "base").ValueKind != JsonValueKind.Undefined {
                    RepositoryIdentity.CommitSha(J.Text(metadata, "base"))
                }

                if !Regex.IsMatch(J.Text(metadata, "branch"), "^tokate/v2-[0-9a-f-]{36}$") || J.Number(
                    metadata,
                    "pr"
                ) < 1 ||
                    J.Number(metadata, "seconds") < 1 || J.Text(metadata, "verification") != "donor-reported-pass" {
                    throw CliFailure("invalid_state", "Invalid amendment declaration")
                }

                let tools = J.Get(metadata, "tools")

                if tools.ValueKind != JsonValueKind.Array {
                    throw CliFailure("invalid_state", "Amendment tools must be an array")
                }

                if J.Count(tools) > 0 {
                    Tools(tools)
                }
            } else {
                throw CliFailure("invalid_state", "Only claim, publish and amend are donor request operations")
            }

            let summary = J.Get(metadata, "summary")
            if summary.ValueKind != JsonValueKind.Undefined {
                PublicSummary.Validate(summary, J.Text(metadata, "head"))
            }
        }
    }
}
