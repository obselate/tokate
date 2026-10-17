package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json
import System.Text.RegularExpressions

internal class Data {
    private let Stored Dictionary[string, Object?] = map[string, Object?]{}

    internal prop Amendment string {
        get -> Text("amendment")
        set -> Put("amendment", value)
    }

    internal prop Amendments JsonElement {
        get -> Element("amendments")
        set -> Put("amendments", value)
    }

    internal prop Approval string {
        get -> Text("approval")
        set -> Put("approval", value)
    }

    internal prop Attempt string {
        get -> Text("attempt")
        set -> Put("attempt", value)
    }

    internal prop AuthorityRevision string {
        get -> Text("authority_revision")
        set -> Put("authority_revision", value)
    }

    internal prop Base string {
        get -> Text("base")
        set -> Put("base", value)
    }

    internal prop BaseBranch string {
        get -> Text("base_branch")
        set -> Put("base_branch", value)
    }

    internal prop Body string {
        get -> Text("body")
        set -> Put("body", value)
    }

    internal prop Branch string {
        get -> Text("branch")
        set -> Put("branch", value)
    }

    internal prop BranchCreationAttempted bool {
        get -> Flag("branch_creation_attempted")
        set -> Put("branch_creation_attempted", value)
    }

    internal prop BranchCreationError string {
        get -> Text("branch_creation_error")
        set -> Put("branch_creation_error", value)
    }

    internal prop BranchPrepared bool {
        get -> Flag("branch_prepared")
        set -> Put("branch_prepared", value)
    }

    internal prop CheckoutPrepared string {
        get -> Text("checkout_prepared")
        set -> Put("checkout_prepared", value)
    }

    internal prop CheckoutStaging string {
        get -> Text("checkout_staging")
        set -> Put("checkout_staging", value)
    }

    internal prop ChecksHead string {
        get -> Text("checks_head")
        set -> Put("checks_head", value)
    }

    internal prop ClaimRequest JsonElement {
        get -> Element("claim_request")
        set -> Put("claim_request", value)
    }

    internal prop ClaudeProfile string {
        get -> Text("claude_profile")
        set -> Put("claude_profile", value)
    }

    internal prop ClaudeVersion string {
        get -> Text("claude_version")
        set -> Put("claude_version", value)
    }

    internal prop CodexVersion string {
        get -> Text("codex_version")
        set -> Put("codex_version", value)
    }

    internal prop Commit string {
        get -> Text("commit")
        set -> Put("commit", value)
    }

    internal prop Continuation JsonElement {
        get -> Element("continuation")
        set -> Put("continuation", value)
    }

    internal prop ContinuationManifestSha256 string {
        get -> Text("continuation_manifest_sha256")
        set -> Put("continuation_manifest_sha256", value)
    }

    internal prop ContinuationPending string {
        get -> Text("continuation_pending")
        set -> Put("continuation_pending", value)
    }

    internal prop ContinuationPhase string {
        get -> Text("continuation_phase")
        set -> Put("continuation_phase", value)
    }

    internal prop ContinuationSource string {
        get -> Text("continuation_source")
        set -> Put("continuation_source", value)
    }

    internal prop ContinuationSourceMetadataSha256 string {
        get -> Text("continuation_source_metadata_sha256")
        set -> Put("continuation_source_metadata_sha256", value)
    }

    internal prop Correction JsonElement {
        get -> Element("correction")
        set -> Put("correction", value)
    }

    internal prop DiscussionAttempted bool {
        get -> Flag("discussion_attempted")
        set -> Put("discussion_attempted", value)
    }

    internal prop DiscussionError string {
        get -> Text("discussion_error")
        set -> Put("discussion_error", value)
    }

    internal prop DiscussionUrl string {
        get -> Text("discussion_url")
        set -> Put("discussion_url", value)
    }

    internal prop Donor string {
        get -> Text("donor")
        set -> Put("donor", value)
    }

    internal prop DonorId int64 {
        get -> Int64("donor_id")
        set -> Put("donor_id", value)
    }

    internal prop Effort string {
        get -> Text("effort")
        set -> Put("effort", value)
    }

    internal prop ElapsedSeconds int32 {
        get -> Number("elapsed_seconds")
        set -> Put("elapsed_seconds", value)
    }

    internal prop EndpointCatalog JsonElement {
        get -> Element("endpoint_catalog")
        set -> Put("endpoint_catalog", value)
    }

    internal prop Error string {
        get -> Text("error")
        set -> Put("error", value)
    }

    internal prop ErrorTruncated bool {
        get -> Flag("error_truncated")
        set -> Put("error_truncated", value)
    }

    internal prop ExecutionSeconds int32 {
        get -> Number("execution_seconds")
        set -> Put("execution_seconds", value)
    }

    internal prop Expected string {
        get -> Text("expected")
        set -> Put("expected", value)
    }

    internal prop ExternalHistory JsonElement {
        get -> Element("external_history")
        set -> Put("external_history", value)
    }

    internal prop FailureReason string {
        get -> Text("failure_reason")
        set -> Put("failure_reason", value)
    }

    internal prop FailureStage string {
        get -> Text("failure_stage")
        set -> Put("failure_stage", value)
    }

    internal prop Findings string {
        get -> Text("findings")
        set -> Put("findings", value)
    }

    internal prop ForkCreationAttempted bool {
        get -> Flag("fork_creation_attempted")
        set -> Put("fork_creation_attempted", value)
    }

    internal prop ForkCreationError string {
        get -> Text("fork_creation_error")
        set -> Put("fork_creation_error", value)
    }

    internal prop Gratis bool {
        get -> Flag("gratis")
        set -> Put("gratis", value)
    }

    internal prop GratisContext JsonElement {
        get -> Element("gratis_context")
        set -> Put("gratis_context", value)
    }

    internal prop GratisTitle string {
        get -> Text("gratis_title")
        set -> Put("gratis_title", value)
    }

    internal prop Handoff JsonElement {
        get -> Element("handoff")
        set -> Put("handoff", value)
    }

    internal prop Harness string {
        get -> Text("harness")
        set -> Put("harness", value)
    }

    internal prop HarnessPath string {
        get -> Text("harness_path")
        set -> Put("harness_path", value)
    }

    internal prop HeadRepo string {
        get -> Text("head_repo")
        set -> Put("head_repo", value)
    }

    internal prop Id string {
        get -> Text("id")
        set -> Put("id", value)
    }

    internal prop Incomplete bool {
        get -> Flag("incomplete")
        set -> Put("incomplete", value)
    }

    internal prop InferenceExitCode int32? {
        get -> Number("inference_exit_code")
        set -> Put("inference_exit_code", value)
    }

    internal prop Issue int32 {
        get -> Number("issue")
        set -> Put("issue", value)
    }

    internal prop Model string {
        get -> Text("model")
        set -> Put("model", value)
    }

    internal prop Name string {
        get -> Text("name")
        set -> Put("name", value)
    }

    internal prop NativeReports JsonElement {
        get -> Element("native_reports")
        set -> Put("native_reports", value)
    }

    internal prop ObservedInvocation JsonElement {
        get -> Element("observed_invocation")
        set -> Put("observed_invocation", value)
    }

    internal prop OmpVersion string {
        get -> Text("omp_version")
        set -> Put("omp_version", value)
    }

    internal prop OriginalEvidenceSha256 string {
        get -> Text("original_evidence_sha256")
        set -> Put("original_evidence_sha256", value)
    }

    internal prop OutputTruncated bool {
        get -> Flag("output_truncated")
        set -> Put("output_truncated", value)
    }

    internal prop PartialSourceState string {
        get -> Text("partial_source_state")
        set -> Put("partial_source_state", value)
    }

    internal prop PatchSha256 string {
        get -> Text("patch_sha256")
        set -> Put("patch_sha256", value)
    }

    internal prop PiEndpoint string {
        get -> Text("pi_endpoint")
        set -> Put("pi_endpoint", value)
    }

    internal prop PiNode string {
        get -> Text("pi_node")
        set -> Put("pi_node", value)
    }

    internal prop PiRoot string {
        get -> Text("pi_root")
        set -> Put("pi_root", value)
    }

    internal prop PiVersion string {
        get -> Text("pi_version")
        set -> Put("pi_version", value)
    }

    internal prop Policy JsonElement {
        get -> Element("policy")
        set -> Put("policy", value)
    }

    internal prop PolicyHash string {
        get -> Text("policy_hash")
        set -> Put("policy_hash", value)
    }

    internal prop Pr int32 {
        get -> Number("pr")
        set -> Put("pr", value)
    }

    internal prop PrUrl string {
        get -> Text("pr_url")
        set -> Put("pr_url", value)
    }

    internal prop PreparationComplete bool {
        get -> Flag("preparation_complete")
        set -> Put("preparation_complete", value)
    }

    internal prop PreparationHead string {
        get -> Text("preparation_head")
        set -> Put("preparation_head", value)
    }

    internal prop PreparationHeadId int64 {
        get -> Int64("preparation_head_id")
        set -> Put("preparation_head_id", value)
    }

    internal prop PreparationIdentity string {
        get -> Text("preparation_identity")
        set -> Put("preparation_identity", value)
    }

    internal prop PreparationRepoId int64 {
        get -> Int64("preparation_repo_id")
        set -> Put("preparation_repo_id", value)
    }

    internal prop PreparationVersion int32 {
        get -> Number("preparation_version")
        set -> Put("preparation_version", value)
    }

    internal prop Previous string {
        get -> Text("previous")
        set -> Put("previous", value)
    }

    internal prop PreviousBody string {
        get -> Text("previous_body")
        set -> Put("previous_body", value)
    }

    internal prop PreviousRemote string {
        get -> Text("previous_remote")
        set -> Put("previous_remote", value)
    }

    internal prop Provider string {
        get -> Text("provider")
        set -> Put("provider", value)
    }

    internal prop PublicReport string {
        get -> Text("public_report")
        set -> Put("public_report", value)
    }

    internal prop PublicSummary JsonElement {
        get -> Element("public_summary")
        set -> Put("public_summary", value)
    }

    internal prop Publication JsonElement {
        get -> Element("publication")
        set -> Put("publication", value)
    }

    internal prop PublicationAttempt string {
        get -> Text("publication_attempt")
        set -> Put("publication_attempt", value)
    }

    internal prop PublicationAttempted bool {
        get -> Flag("publication_attempted")
        set -> Put("publication_attempted", value)
    }

    internal prop PublicationExpected string {
        get -> Text("publication_expected")
        set -> Put("publication_expected", value)
    }

    internal prop PublicationPr int32 {
        get -> Number("publication_pr")
        set -> Put("publication_pr", value)
    }

    internal prop PublicationUuid string {
        get -> Text("publication_uuid")
        set -> Put("publication_uuid", value)
    }

    internal prop Ready bool {
        get -> Flag("ready")
        set -> Put("ready", value)
    }

    internal prop ReceiptHash string {
        get -> Text("receipt_hash")
        set -> Put("receipt_hash", value)
    }

    internal prop Refusal string {
        get -> Text("refusal")
        set -> Put("refusal", value)
    }

    internal prop Repo string {
        get -> Text("repo")
        set -> Put("repo", value)
    }

    internal prop ReportedModel string? {
        get -> NullableText("reported_model")
        set -> Put("reported_model", value)
    }

    internal prop Request JsonElement {
        get -> Element("request")
        set -> Put("request", value)
    }

    internal prop RequestedFork string {
        get -> Text("requested_fork")
        set -> Put("requested_fork", value)
    }

    internal prop RequestedModel string? {
        get -> Text("requested_model")
        set -> Put("requested_model", value)
    }

    internal prop Reservation string {
        get -> Text("reservation")
        set -> Put("reservation", value)
    }

    internal prop ReservationRequest JsonElement {
        get -> Element("reservation_request")
        set -> Put("reservation_request", value)
    }

    internal prop Seconds int32 {
        get -> Number("seconds")
        set -> Put("seconds", value)
    }

    internal prop SecondsSha256 string -> Text("seconds_sha256")

    internal prop Selection JsonElement {
        get -> Element("selection")
        set -> Put("selection", value)
    }

    internal prop Snapshot string {
        get -> Text("snapshot")
        set -> Put("snapshot", value)
    }

    internal prop Source string {
        get -> Text("source")
        set -> Put("source", value)
    }

    internal prop State string {
        get -> Text("state")
        set -> Put("state", value)
    }

    internal prop StateSha string {
        get -> Text("state_sha")
        set -> Put("state_sha", value)
    }

    internal prop SummaryArgument string {
        get -> Text("summary_argument")
        set -> Put("summary_argument", value)
    }

    internal prop SummaryPatchSha256 string {
        get -> Text("summary_patch_sha256")
        set -> Put("summary_patch_sha256", value)
    }

    internal prop SummarySha256 string {
        get -> Text("summary_sha256")
        set -> Put("summary_sha256", value)
    }

    internal prop ToolProvenance string {
        get -> Text("tool_provenance")
        set -> Put("tool_provenance", value)
    }

    internal prop Tools JsonElement {
        get -> Element("tools")
        set -> Put("tools", value)
    }

    internal prop ToolsArgument string {
        get -> Text("tools_argument")
        set -> Put("tools_argument", value)
    }

    internal prop ToolsSha256 string {
        get -> Text("tools_sha256")
        set -> Put("tools_sha256", value)
    }

    internal prop Tree string {
        get -> Text("tree")
        set -> Put("tree", value)
    }

    internal prop TurnCompleted bool {
        get -> Flag("turn_completed")
        set -> Put("turn_completed", value)
    }

    internal prop Unlimited bool {
        get -> Flag("unlimited")
        set -> Put("unlimited", value)
    }

    internal prop Usage JsonElement {
        get -> Element("usage")
        set -> Put("usage", value)
    }

    internal prop UsageProvenance string {
        get -> Text("usage_provenance")
        set -> Put("usage_provenance", value)
    }

    internal prop Uuid string {
        get -> Text("uuid")
        set -> Put("uuid", value)
    }

    internal prop Verification JsonElement {
        get -> Element("verification")
        set -> Put("verification", value)
    }

    internal prop VerificationProvenance string {
        get -> Text("verification_provenance")
        set -> Put("verification_provenance", value)
    }

    internal prop VerificationReserve int32 {
        get -> Number("verification_reserve")
        set -> Put("verification_reserve", value)
    }

    internal prop VerificationSeconds int32 {
        get -> Number("verification_seconds")
        set -> Put("verification_seconds", value)
    }

    internal prop VerifiedTargetRevision string {
        get -> Text("verified_target_revision")
        set -> Put("verified_target_revision", value)
    }

    internal prop Version int32 {
        get -> Number("version")
        set -> Put("version", value)
    }

    internal prop WallSeconds int32 {
        get -> Number("wall_seconds")
        set -> Put("wall_seconds", value)
    }

    internal prop HasAttempt bool -> Stored.ContainsKey("attempt")

    internal prop HasBase bool -> Stored.ContainsKey("base")

    internal prop HasClaudeVersion bool -> Stored.ContainsKey("claude_version")

    internal prop HasCodexVersion bool -> Stored.ContainsKey("codex_version")

    internal prop HasCommit bool -> Stored.ContainsKey("commit")

    internal prop HasContinuationManifestSha256 bool -> Stored.ContainsKey("continuation_manifest_sha256")

    internal prop HasCorrection bool -> Stored.ContainsKey("correction")

    internal prop HasError bool -> Stored.ContainsKey("error")

    internal prop HasFailureReason bool -> Stored.ContainsKey("failure_reason")

    internal prop HasId bool -> Stored.ContainsKey("id")

    internal prop HasIncomplete bool -> Stored.ContainsKey("incomplete")

    internal prop HasOmpVersion bool -> Stored.ContainsKey("omp_version")

    internal prop HasPiVersion bool -> Stored.ContainsKey("pi_version")

    internal prop HasPreparationHeadId bool -> Stored.ContainsKey("preparation_head_id")

    internal prop HasPreparationIdentity bool -> Stored.ContainsKey("preparation_identity")

    internal prop HasPreparationRepoId bool -> Stored.ContainsKey("preparation_repo_id")

    internal prop HasPublicationError bool -> Stored.ContainsKey("publication_error")

    internal prop HasPublicationExpected bool -> Stored.ContainsKey("publication_expected")

    internal prop HasPublicationUuid bool -> Stored.ContainsKey("publication_uuid")

    internal prop HasRequestedModel bool -> Stored.ContainsKey("requested_model")

    internal prop HasSnapshot bool -> Stored.ContainsKey("snapshot")

    internal prop HasVerificationReserve bool -> Stored.ContainsKey("verification_reserve")

    internal prop HasWallSeconds bool -> Stored.ContainsKey("wall_seconds")

    internal func ClearContinuationPending() {
        Stored.Remove("continuation_pending")
    }

    internal func ClearError() {
        Stored.Remove("error")
    }

    internal func ClearFailureReason() {
        Stored.Remove("failure_reason")
    }

    internal func ClearFailureStage() {
        Stored.Remove("failure_stage")
    }

    internal func ClearPublicSummary() {
        Stored.Remove("public_summary")
    }

    internal func ClearReservationRequest() {
        Stored.Remove("reservation_request")
    }

    internal func ClearToolProvenance() {
        Stored.Remove("tool_provenance")
    }

    internal func ClearVerificationProvenance() {
        Stored.Remove("verification_provenance")
    }

    internal func ClearSummaryPatchSha256() {
        Stored.Remove("summary_patch_sha256")
    }

    internal prop HasInferenceExitCode bool -> Stored.ContainsKey("inference_exit_code")

    internal func ClearIncomplete() {
        Stored.Remove("incomplete")
    }

    internal func ClearPublicationError() {
        Stored.Remove("publication_error")
    }

    private func Field(key string) Object? {
        var value Object?
        return Stored.TryGetValue(key, out value) ? value: nil
    }

    private func Text(key string) string -> switch Field(key) {
        case text is string: text
        case element is JsonElement: element.ValueKind == JsonValueKind.String ? element.GetString() ?? "": ""
        default: ""
    }

    private func NullableText(key string) string? -> switch Field(key) {
        case nil: nil
        case text is string: text
        case element is JsonElement: element.ValueKind == JsonValueKind.Null ? nil:
        element.ValueKind == JsonValueKind.String ? element.GetString() ?? "": ""
        default: ""
    }

    private func Number(key string) int32 {
        let value = Field(key)
        var number int32
        return value is int32 direct ? direct:
        value is JsonElement element && element.ValueKind == JsonValueKind.Number && element.TryGetInt32(
            out number
        ) ? number: 0
    }

    private func Int64(key string) int64 {
        let value = Field(key)
        var number int64
        return value is int64 direct ? direct: value is int32 small ? small:
        value is JsonElement element && element.ValueKind == JsonValueKind.Number && element.TryGetInt64(
            out number
        ) ? number: 0
    }

    private func Flag(key string) bool -> switch Field(key) {
        case flag is bool: flag
        case element is JsonElement: element.ValueKind == JsonValueKind.True
        default: false
    }

    private func Element(key string) JsonElement -> Field(key) is JsonElement element ? element: JsonElement{}

    private func Put(key string, value Object?) {
        Stored[key] = value
    }

    internal prop UnlimitedIsValid bool -> switch Field("unlimited") {
        case nil: true
        case flag is bool: true
        case element is JsonElement: element.ValueKind == JsonValueKind.True ||
            element.ValueKind == JsonValueKind.False ||
            element.ValueKind == JsonValueKind.Undefined
        default: false
    }

    internal func HarnessVersion(name string) string -> switch name {
        case "codex": CodexVersion
        case "pi": PiVersion
        case "claude": ClaudeVersion
        case "omp": OmpVersion
        default: ""
    }

    internal func HasHarnessVersion(name string) bool -> switch name {
        case "codex": HasCodexVersion
        case "pi": HasPiVersion
        case "claude": HasClaudeVersion
        case "omp": HasOmpVersion
        default: false
    }

    internal func Element() JsonElement -> J.Parse(ToJson())

    internal func ToJson() string -> J.Write(Stored)

    internal func Transition(next string) {
        let current = State
        if current != "" && next == current {
            return
        }
        let allowed = switch current {
            case "": next == "claim_pending" || next == "preparing" || next == "validating"
            case "claim_pending": next == "preparing"
            case "preparing": next == "claimed"
            case "claimed": next == "running" || next == "verifying" || next == "failed"
            case "running":
            next == "generated" ||
                next == "failed" ||
                next == "incomplete_generated" ||
                next == "refused" ||
                next == "skipped"
            case "failed":
            next == "verifying" || next == "generated" || next == "incomplete_generated"
            case "validating": next == "verifying" || next == "failed"
            case "verifying": next == "verified" || next == "generated" || next == "failed"
            case "verified": next == "publishing" || next == "published"
            case "publishing": next == "requested" || next == "published"
            case "requested": next == "published"
            case "generated": next == "published"
            case "incomplete_generated": next == "published" || next == "generated"
            case "skipped": next == "published"
            default: false
        }
        if !allowed {
            throw CliFailure("invalid_state", "Invalid run state transition: " + current + " -> " + next)
        }
        State = next
    }

    internal func Save(directory string) {
        RunStorage.ControlPaths(directory)
        Write(Path.Combine(directory, "run.json"))
    }

    internal func Write(path string) {
        try {
            File.WriteAllText(path + ".tmp", ToJson() + "\n")
            File.Move(path + ".tmp", path, true)
        } catch (error IOException) {
            throw CliFailure("command_failed", error.Message, summary: CliFailure.Message("command_failed"))
        } catch (error UnauthorizedAccessException) {
            throw CliFailure("command_failed", error.Message, summary: CliFailure.Message("command_failed"))
        }
    }

    shared {
        private const FormatName string = "Saved run"

        internal func Load(directory string, amendment bool = false) Data {
            let path = Path.Combine(directory, "run.json")
            try {
                RunStorage.ControlPaths(directory)
            } catch (error CliFailure) {
                throw CliFailure("invalid_state", "Cannot read saved run " + path + ": " + error.Message)
            }

            return Read(path, required: !amendment)
        }

        internal func ValidateRequired(value JsonElement, format string = "Saved run") {
            if JsonFields.Int32(value, format, "version") != 2 {
                throw InvalidRequired(format, "version")
            }

            if JsonFields.String(value, format, "repo") == "" {
                throw InvalidRequired(format, "repo")
            }

            let issue = JsonFields.Int32(value, format, "issue")
            if issue < 1 && !(issue == 0 && J.Get(value, "gratis").ValueKind == JsonValueKind.True) {
                throw InvalidRequired(format, "issue")
            }

            if JsonFields.String(value, format, "state") == "" {
                throw InvalidRequired(format, "state")
            }
        }

        private func InvalidRequired(format string, field string) CliFailure -> CliFailure(
            "invalid_state",
            format +
                " has a missing or invalid field: " +
                field +
                ". Restore the original saved run file. No approval change is required."
        )

        internal func LegacyCorrection(path string) Data {
            let change = Read(path)
            let state = change.State
            var uuid Guid
            if change.Version != 1 || !Guid.TryParse(change.Uuid, out uuid) ||
                change.Id != change.Uuid ||
                !Regex.IsMatch(change.Commit, "^[0-9a-f]{40}\\z") ||
                (state != "validating" && state != "verifying" && state != "verified" && state != "failed") {
                throw CliFailure(
                    "invalid_state",
                    "Cannot migrate the legacy correction. Inspect " +
                        path +
                        " and restore its original record and artifacts before retrying."
                )
            }
            return change
        }

        internal func Migrate(directory string) {
            let legacy = Path.Combine(directory, "correction.json")
            if File.Exists(legacy) {
                let run = Load(directory)
                RunStorage.ControlFile(directory, "correction.json")
                let change = LegacyCorrection(legacy)
                let commit = change.Commit
                let id = change.Uuid
                for source in Directory.EnumerateDirectories(directory, "correction-*") {
                    LocalPaths.DirectoryPath(source)
                    RunStorage.ControlFile(source, "record.json")
                    if !File.Exists(Path.Combine(source, "record.json")) {
                        continue
                    }
                    let attempt = Read(Path.Combine(source, "record.json"))
                    let attemptId = attempt.Uuid
                    var attemptUuid Guid
                    let attemptCommit = attempt.Commit
                    let attemptState = attempt.State
                    if attempt.Version != 1 || !Guid.TryParse(attemptId, out attemptUuid) ||
                        attempt.Id != attemptId ||
                        Path.GetFileName(source) != "correction-" + attemptId || !Regex.IsMatch(
                        attemptCommit,
                        "^[0-9a-f]{40}\\z"
                    ) ||
                        (
                        attemptState != "validating" &&
                            attemptState != "verifying" &&
                            attemptState != "verified" &&
                            attemptState != "failed"
                    ) {
                        continue
                    }
                    let destination = Path.Combine(directory, "amendments", attemptCommit)
                    Directory.CreateDirectory(Path.Combine(directory, "amendments"))
                    LocalPaths.DirectoryPath(Path.Combine(directory, "amendments"))
                    if !Directory.Exists(destination) {
                        Directory.Move(source, destination)
                        RunStorage.ControlPaths(destination)
                        File.Move(Path.Combine(destination, "record.json"), Path.Combine(destination, "run.json"))
                    }
                }
                let source = Path.Combine(directory, "correction-" + id)
                let target = Path.Combine(directory, "amendments", commit)
                if Directory.Exists(target) {
                    RunStorage.ControlPaths(target)
                }
                if Directory.Exists(source) || !Directory.Exists(target) ||
                    (
                    File.Exists(Path.Combine(target, "run.json")) && !RequestData.Same(
                        Read(Path.Combine(target, "run.json")).Element(),
                        change.Element()
                    )
                ) {
                    throw CliFailure(
                        "invalid_state",
                        "Cannot map legacy correction artifacts safely. Inspect " +
                            source +
                            " and " +
                            target +
                            " before retrying."
                    )
                }
                change.Save(target)
                run.Amendment = commit
                run.Save(directory)
                File.Delete(Path.Combine(target, "record.json"))
                File.Delete(legacy)
            }
        }

        internal func Read(path string, required bool = false) Data -> Parse(
            ReadElement(path),
            required,
            FormatName + " " + path
        )

        internal func ReadElement(path string) JsonElement {
            try {
                let value = J.Parse(File.ReadAllText(path))
                if value.ValueKind != JsonValueKind.Object {
                    throw CliFailure(
                        "invalid_state",
                        "Saved file " + path + " must contain a JSON object. Restore the original saved file."
                    )
                }
                return value
            } catch (error JsonException) {
                throw CliFailure(
                    "invalid_state",
                    "Malformed JSON in " + path + ": " + error.Message + " Restore the original saved file."
                )
            } catch (error IOException) {
                throw CliFailure(
                    "invalid_state",
                    "Cannot read saved file " +
                        path +
                        ": " +
                        error.Message +
                        " Select an existing run with tokate status."
                )
            } catch (error UnauthorizedAccessException) {
                throw CliFailure(
                    "invalid_state",
                    "Cannot read saved file " + path + ": " + error.Message + " Check file access before retrying."
                )
            }
        }

        internal func Parse(value JsonElement, required bool = false, format string = "Saved run") Data {
            let result = Data()

            try {
                for field in value.EnumerateObject() {
                    result.Stored[field.Name] = field.Value.Clone()
                }
            } catch (error InvalidOperationException) {
                throw CliFailure("invalid_state", error.Message, summary: CliFailure.Message("invalid_state"))
            }

            if required {
                ValidateRequired(value, format)
            }

            return result
        }
    }
}
