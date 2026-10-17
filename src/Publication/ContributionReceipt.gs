package Tokate

import System.Collections.Generic
import System.IO
import System.Text
import System.Text.Json

internal class ContributionReceipt {
    internal class Record(value JsonElement) {
        private let source JsonElement = value
        internal let Version int32 = JsonFields.Int32(value, "PR receipt", "version")
        internal let Repo string = JsonFields.String(value, "PR receipt", "repo")
        internal let Issue int32 = JsonFields.Int32(value, "PR receipt", "issue")
        internal let Approval string = JsonFields.String(value, "PR receipt", "approval")
        internal let Expected string = JsonFields.String(value, "PR receipt", "expected")
        internal let Reservation string = JsonFields.String(value, "PR receipt", "reservation")
        internal let Donor string = JsonFields.String(value, "PR receipt", "donor")
        internal let Head string = JsonFields.String(value, "PR receipt", "head")
        internal let RequestedModel JsonElement = J.Get(value, "requested_model")
        internal let ReportedModel JsonElement = J.Get(value, "reported_model")
        internal let Correction JsonElement = J.Get(value, "correction")
        internal let Handoff JsonElement = J.Get(value, "handoff")
        internal let Incomplete JsonElement = J.Get(value, "incomplete")
        internal let Predecessor JsonElement = J.Get(value, "predecessor")
        internal let ImportManifestSha256 JsonElement = J.Get(value, "import_manifest_sha256")
        internal let Attempt JsonElement = J.Get(value, "attempt")
        internal let Amendment JsonElement = J.Get(value, "amendment")

        internal func Write(writer Utf8JsonWriter) -> source.WriteTo(writer)

        internal func ToJson() JsonElement -> source

        internal func ToText() string {
            using let bytes = MemoryStream()
            using let writer = Utf8JsonWriter(bytes)

            Write(writer)
            writer.Flush()

            return Encoding.UTF8.GetString(bytes.ToArray())
        }

        shared {
            internal func Parse(value JsonElement) Record {
                if J.Number(value, "version") != 2 {
                    throw CliFailure("invalid_state", "Unsupported receipt protocol")
                }

                return Record(value)
            }
        }
    }

    shared {
        internal func Coordinated(
            repo string,
            issue int32,
            approval string,
            expected string,
            reservation string,
            donor string,
            head string
        ) Dictionary[string, Object?] -> map[string, Object?]{
            "version": 2,
            "repo": repo,
            "issue": issue,
            "approval": approval,
            "expected": expected,
            "reservation": reservation,
            "donor": donor,
            "head": head
        }

        internal func Publication(
            repo string,
            issue int32,
            request JsonElement,
            reservation string,
            donor string
        ) Record {
            let declaration = CoordinatorRequest.Parse(request)
            let metadata = declaration.Metadata
            let publication = PublicationRequestMetadata.Parse(metadata)
            let receipt = Coordinated(
                repo,
                issue,
                declaration.Approval,
                declaration.Expected,
                reservation,
                donor,
                publication.Head
            )
            Models(receipt, publication)

            if publication.Correction.ValueKind != JsonValueKind.Undefined {
                receipt["correction"] = publication.Correction
            }

            if publication.Handoff.ValueKind != JsonValueKind.Undefined {
                receipt["handoff"] = publication.Handoff
            }

            if publication.HasIncomplete {
                receipt["incomplete"] = publication.Incomplete
            }

            AttemptContinuation.Keep(receipt, metadata)
            return Record.Parse(J.Parse(J.Write(receipt)))
        }

        internal func Models(fields Dictionary[string, Object?], metadata PublicationRequestMetadata) {
            if metadata.HasRequestedModel {
                fields["requested_model"] = metadata.RequestedModel
            }

            if metadata.HasReportedModel {
                fields["reported_model"] = metadata.ReportedModel
            }
        }

        internal func Models(fields Dictionary[string, Object?], value JsonElement) {
            for key in[]string{"requested_model", "reported_model"} {
                let model = J.Get(value, key)
                if model.ValueKind != JsonValueKind.Undefined {
                    fields[key] = model
                }
            }
        }

        internal func FromState(state CoordinationState) JsonElement {
            let current = state.Current()
            let original = state.Contribution
            let fields = Coordinated(
                state.Repo,
                state.Issue,
                state.ApprovalId,
                current?.Expected ?? "",
                state.Lease?.Reservation ?? "",
                original?.Donor ?? "",
                current?.Outcome.Head ?? ""
            )
            let metadata = original?.Metadata ?? default(JsonElement)
            let publication = PublicationRequestMetadata.Parse(metadata)
            Models(fields, publication)
            let correction = publication.Correction
            let handoff = publication.Handoff

            if handoff.ValueKind != JsonValueKind.Undefined {
                fields["handoff"] = handoff
            }

            if state.Amendments.Count == 0 && RequestMetadata.Incomplete(
                publication.HasIncomplete,
                publication.Incomplete
            ) {
                fields["incomplete"] = true
            }

            AttemptContinuation.Keep(fields, original?.Metadata ?? default(JsonElement))

            if correction.ValueKind != JsonValueKind.Undefined {
                fields["correction"] = correction
            }

            if state.Amendments.Count > 0 {
                let amended = map[string, Object?]{
                    "id": current?.Request ?? "",
                    "previous": current?.Previous ?? "",
                    "seconds": current?.Seconds ?? 0,
                    "tools": current?.Tools ?? default(JsonElement)
                }

                if (current?.Base ?? "") != "" {
                    amended["base"] = current?.Base ?? ""
                }

                fields["amendment"] = PublicSummary.Attach(amended, current?.Summary ?? default(JsonElement))
            }

            return J.Parse(J.Write(fields))
        }
    }
}
