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
        let allowed = switch current {
            case "": next == "claim_pending" || next == "preparing" || next == "validating"
            case "claim_pending": next == current || next == "preparing"
            case "preparing": next == current || next == "claimed"
            case "claimed": next == current || next == "running" || next == "verifying" || next == "failed"
            case "running": next == current ||
                next == "generated" ||
                next == "failed" ||
                next == "incomplete_generated" ||
                next == "refused" ||
                next == "skipped"
            case "failed": next == current ||
                next == "verifying" ||
                next == "generated" ||
                next == "incomplete_generated"
            case "validating": next == current || next == "verifying" || next == "failed"
            case "verifying": next == current || next == "verified" || next == "generated" || next == "failed"
            case "verified": next == current || next == "publishing" || next == "published"
            case "publishing": next == current || next == "requested" || next == "published"
            case "requested": next == current || next == "published"
            case "generated": next == current || next == "published"
            case "incomplete_generated": next == current || next == "published" || next == "generated"
            case "skipped": next == current || next == "published"
            case "published": next == current
            case "refused": next == current
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
        internal func Load(directory string) Data {
            RunStorage.ControlPaths(directory)
            let run = Read(Path.Combine(directory, "run.json"))
            let legacy = Path.Combine(directory, "correction.json")
            if File.Exists(legacy) {
                RunStorage.ControlFile(directory, "correction.json")
                let change = Read(legacy)
                let commit = change.Text("commit")
                let state = change.Text("state")
                let id = change.Text("uuid")
                var uuid Guid
                if change.Number("version") != 1 || !Guid.TryParse(id, out uuid) || change.Text("id") != id ||
                    !Regex.IsMatch(commit, "^[0-9a-f]{40}\\z") ||
                    (state != "validating" && state != "verifying" && state != "verified" && state != "failed") {
                    throw CliFailure(
                        "invalid_state",
                        "Cannot migrate the legacy correction. Inspect " +
                            legacy +
                            " and restore its original record and artifacts before retrying."
                    )
                }
                let source = Path.Combine(directory, "correction-" + id)
                let target = Path.Combine(directory, "amendments", commit)
                if Directory.Exists(source) && !Directory.Exists(target) {
                    LocalPaths.DirectoryPath(source)
                    Directory.CreateDirectory(Path.Combine(directory, "amendments"))
                    LocalPaths.DirectoryPath(Path.Combine(directory, "amendments"))
                    Directory.Move(source, target)
                }
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
            return run
        }

        internal func Read(path string) Data {
            try {
                return From(J.Parse(File.ReadAllText(path)))
            } catch (error JsonException) {
                throw CliFailure("invalid_state", error.Message, summary: PublicOutput.Message("invalid_state"))
            } catch (error IOException) {
                throw CliFailure("invalid_state", error.Message, summary: PublicOutput.Message("invalid_state"))
            } catch (error UnauthorizedAccessException) {
                throw CliFailure("invalid_state", error.Message, summary: PublicOutput.Message("invalid_state"))
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
