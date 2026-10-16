package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Security.Cryptography
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

internal class Data(fields Dictionary[string, Object?]? = nil) {
    internal let Fields Dictionary[string, Object?] = fields ?? Dictionary[string, Object?]()

    internal func Text(key string) string -> J.Text(Field(key), key)

    internal func Number(key string) int32 -> J.Number(Field(key), key)

    internal func Flag(key string) bool -> J.Bool(Field(key), key)

    private func Field(key string) JsonElement {
        var value Object?
        return Fields.TryGetValue(key, out value) ? J.Parse(J.Write(map[string, Object?]{key: value})): JsonElement{}
    }

    internal func Element() JsonElement -> J.Parse(J.Write(Fields))

    internal func Transition(next string) {
        let current = Text("state")
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
        Fields["state"] = next
    }

    internal func Save(directory string) {
        RunStorage.ControlPaths(directory)
        Write(Path.Combine(directory, "run.json"))
    }

    internal func Write(path string) {
        try {
            File.WriteAllText(path + ".tmp", J.Write(Fields) + "\n")
            File.Move(path + ".tmp", path, true)
        } catch (error IOException) {
            throw CliFailure("command_failed", error.Message, summary: PublicOutput.Message("command_failed"))
        } catch (error UnauthorizedAccessException) {
            throw CliFailure("command_failed", error.Message, summary: PublicOutput.Message("command_failed"))
        }
    }

    shared {
        internal func Load(directory string, amendment bool = false) Data {
            let path = Path.Combine(directory, "run.json")
            try {
                RunStorage.ControlPaths(directory)
            } catch (error CliFailure) {
                throw CliFailure("invalid_state", "Cannot read saved run " + path + ": " + error.Message)
            }
            let run = Read(path)
            if amendment {
                return run
            }
            let field = InvalidField(run.Element())
            if field != "" {
                throw CliFailure(
                    "invalid_state",
                    "Saved run " +
                        path +
                        " has a missing or invalid field: " +
                        field +
                        ". Restore the original saved run file. No approval change is required."
                )
            }
            return run
        }

        internal func InvalidField(value JsonElement) string {
            for field in[]string{"version", "repo", "issue", "state"} {
                let item = J.Get(value, field)
                var number int32
                let valid = switch field {
                    case "version": item.ValueKind == JsonValueKind.Number && item.TryGetInt32(out number) &&
                        number == 2
                    case "issue": item.ValueKind == JsonValueKind.Number && item.TryGetInt32(out number) &&
                        (number > 0 || (J.Bool(value, "gratis") && number == 0))
                    default: item.ValueKind == JsonValueKind.String && item.GetString() != ""
                }
                if !valid {
                    return field
                }
            }
            return ""
        }

        internal func LegacyCorrection(path string) Data {
            let change = Read(path)
            let state = change.Text("state")
            var uuid Guid
            if change.Number("version") != 1 || !Guid.TryParse(change.Text("uuid"), out uuid) || change.Text(
                "id"
            ) != change.Text("uuid") || !Regex.IsMatch(change.Text("commit"), "^[0-9a-f]{40}\\z") ||
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
                let commit = change.Text("commit")
                let id = change.Text("uuid")
                for source in Directory.EnumerateDirectories(directory, "correction-*") {
                    LocalPaths.DirectoryPath(source)
                    RunStorage.ControlFile(source, "record.json")
                    if !File.Exists(Path.Combine(source, "record.json")) {
                        continue
                    }
                    let attempt = Read(Path.Combine(source, "record.json"))
                    let attemptId = attempt.Text("uuid")
                    var attemptUuid Guid
                    let attemptCommit = attempt.Text("commit")
                    let attemptState = attempt.Text("state")
                    if attempt.Number("version") != 1 || !Guid.TryParse(attemptId, out attemptUuid) || attempt.Text(
                        "id"
                    ) != attemptId ||
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
                run.Fields["amendment"] = commit
                run.Save(directory)
                File.Delete(Path.Combine(target, "record.json"))
                File.Delete(legacy)
            }
        }

        internal func Read(path string) Data {
            try {
                let value = J.Parse(File.ReadAllText(path))
                if value.ValueKind != JsonValueKind.Object {
                    throw CliFailure(
                        "invalid_state",
                        "Saved file " + path + " must contain a JSON object. Restore the original saved file."
                    )
                }
                return From(value)
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

        internal func From(value JsonElement) Data {
            let result = Data()

            try {
                for field in value.EnumerateObject() {
                    result.Fields[field.Name] = field.Value.Clone()
                }
            } catch (error InvalidOperationException) {
                throw CliFailure("invalid_state", error.Message, summary: PublicOutput.Message("invalid_state"))
            }

            return result
        }

        internal func Hash(text string) string -> Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)))
            .ToLowerInvariant()
    }
}
