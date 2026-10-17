package Tokate

import Gsharp.Extensions.Json
import System
import System.Collections
import System.Collections.Generic
import System.IO
import System.Text
import System.Security.Cryptography
import System.Text.Json

internal class J {
    shared {
        internal func Hash(text string) string -> Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)))
            .ToLowerInvariant()

        internal func Parse(text string) JsonElement {
            using let doc = JsonDocument.Parse(text)
            return doc.RootElement.Clone()
        }

        internal func Parse(stream Stream) JsonElement {
            using let doc = JsonDocument.Parse(stream)
            return doc.RootElement.Clone()
        }

        internal func Get(value JsonElement, key string) JsonElement {
            var result JsonElement
            return value.ValueKind == JsonValueKind.Object && value.TryGetProperty(
                key,
                out result
            ) ? result: JsonElement{}
        }

        internal func Text(value JsonElement, key string) string -> value.GetStringOrNil(key) ?? ""

        internal func Number(value JsonElement, key string) int32 -> value.GetInt32OrNil(key) ?? 0

        internal func Bool(value JsonElement, key string) bool -> value.GetBoolOrNil(key) ?? false

        internal func Select(value JsonElement, keys string) Dictionary[string, Object?] {
            let result = map[string, Object?]{}

            for key in keys.Split(',') {
                let item = J.Get(value, key)
                if item.ValueKind == JsonValueKind.String ||
                    item.ValueKind == JsonValueKind.Number ||
                    item.ValueKind == JsonValueKind.True ||
                    item.ValueKind == JsonValueKind.False {
                    result[key] = item
                }
            }

            return result
        }

        internal func Count(
            value JsonElement
        ) int32 -> value.ValueKind == JsonValueKind.Array ? value.GetArrayLength(): 0

        internal func Items(value JsonElement) List[JsonElement] {
            let items = List[JsonElement]()

            if value.ValueKind == JsonValueKind.Array {
                for item in value.EnumerateArray() {
                    items.Add(item)
                }
            }

            return items
        }

        internal func Write(value Object) string {
            using let bytes = MemoryStream()
            using let writer = Utf8JsonWriter(bytes)

            J.Value(writer, value)
            writer.Flush()

            return Encoding.UTF8.GetString(bytes.ToArray())
        }

        private func Value(writer Utf8JsonWriter, value Object?) {
            switch value {
                case nil {
                    writer.WriteNullValue()
                }
                case text is string {
                    writer.WriteStringValue(text)
                }
                case flag is bool {
                    writer.WriteBooleanValue(flag)
                }
                case number is int32 {
                    writer.WriteNumberValue(number)
                }
                case number is int64 {
                    writer.WriteNumberValue(number)
                }
                case number is float64 {
                    writer.WriteNumberValue(number)
                }
                case element is JsonElement {
                    element.WriteTo(writer)
                }
                case fields is Dictionary[string, Object?] {
                    writer.WriteStartObject()

                    for field in fields {
                        writer.WritePropertyName(field.Key)
                        J.Value(writer, field.Value)
                    }

                    writer.WriteEndObject()
                }
                case items is IEnumerable {
                    writer.WriteStartArray()

                    for item in items {
                        J.Value(writer, item)
                    }

                    writer.WriteEndArray()
                }
                default {
                    throw ArgumentException("Unsupported JSON value")
                }
            }
        }
    }
}

internal class JsonFields {
    shared {
        internal func Int64(value JsonElement, format string, field string) int64 {
            let item = J.Get(value, field)
            var result int64

            if item.ValueKind != JsonValueKind.Number || !item.TryGetInt64(out result) {
                throw Invalid(format, field, "an int64")
            }

            return result
        }

        internal func Bool(value JsonElement, format string, field string) bool {
            let item = J.Get(value, field)

            if item.ValueKind != JsonValueKind.True && item.ValueKind != JsonValueKind.False {
                throw Invalid(format, field, "a boolean")
            }

            return item.GetBoolean()
        }

        internal func Array(value JsonElement, format string, field string) JsonElement {
            let item = J.Get(value, field)

            if item.ValueKind != JsonValueKind.Array {
                throw Invalid(format, field, "an array")
            }

            return item
        }

        private func Invalid(format string, field string, expected string) CliFailure -> CliFailure(
            "invalid_state",
            format + ": field \"" + field + "\" is missing or not " + expected
        )

        internal func String(value JsonElement, format string, field string) string {
            let item = J.Get(value, field)

            if item.ValueKind != JsonValueKind.String {
                throw Invalid(format, field, "a string")
            }

            return item.GetString() ?? ""
        }

        internal func Int32(value JsonElement, format string, field string) int32 {
            let item = J.Get(value, field)
            var result int32

            if item.ValueKind != JsonValueKind.Number || !item.TryGetInt32(out result) {
                throw Invalid(format, field, "an int32")
            }

            return result
        }

        internal func OptionalString(value JsonElement, format string, field string, fallback string) string {
            let item = J.Get(value, field)
            return item.ValueKind == JsonValueKind.Undefined ? fallback: String(value, format, field)
        }

        internal func OptionalInt64(value JsonElement, format string, field string, fallback int64) int64 {
            let item = J.Get(value, field)
            return item.ValueKind == JsonValueKind.Undefined ? fallback: Int64(value, format, field)
        }

        internal func OptionalBool(value JsonElement, format string, field string, fallback bool) bool {
            let item = J.Get(value, field)
            return item.ValueKind == JsonValueKind.Undefined ? fallback: Bool(value, format, field)
        }
    }
}
