package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Security.Cryptography
import System.Text
import System.Text.Json

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
            return Read(Path.Combine(directory, "run.json"))
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
