package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

internal class RequestData {
    shared {
        internal let ModelPattern string = "^(?=.{1,256}\\z)~?[A-Za-z0-9][A-Za-z0-9._:/-]*\\z"

        internal func Same(left JsonElement, right JsonElement) bool {
            if left.ValueKind == JsonValueKind.Undefined || right.ValueKind == JsonValueKind.Undefined {
                return left.ValueKind == right.ValueKind
            }

            return RequestData.Canonical(left) == RequestData.Canonical(right)
        }

        internal func Parse(text string, limit int32 = 8192) JsonElement {
            if Encoding.UTF8.GetByteCount(text) > limit {
                throw CliFailure("invalid_state", "Coordination data exceeds its byte limit")
            }

            try {
                using let document = JsonDocument.Parse(text, JsonDocumentOptions{MaxDepth: 32})
                let value = document.RootElement.Clone()
                Unique(value)
                return value
            } catch (error JsonException) {
                throw CliFailure("invalid_state", error.Message, summary: CliFailure.Message("invalid_state"))
            }
        }

        internal func FileData(path string, limit int32) JsonElement {
            try {
                using let file = File.OpenRead(path)
                using let bytes = MemoryStream()
                let buffer = [8192]byte
                var count int32

                while (
                    count = file.Read(buffer, 0, Math.Min(buffer.Length, limit + 1 - Convert.ToInt32(bytes.Length)))
                ) > 0 {
                    bytes.Write(buffer, 0, count)

                    if bytes.Length > limit {
                        throw CliFailure("invalid_state", "Coordination data exceeds its byte limit")
                    }
                }

                return Parse(Encoding.UTF8.GetString(bytes.ToArray()), limit)
            } catch (error IOException) {
                throw CliFailure("invalid_state", error.Message, summary: CliFailure.Message("invalid_state"))
            } catch (error UnauthorizedAccessException) {
                throw CliFailure("invalid_state", error.Message, summary: CliFailure.Message("invalid_state"))
            }
        }

        private func Unique(value JsonElement) {
            if value.ValueKind == JsonValueKind.Object {
                let names = HashSet[string](StringComparer.Ordinal)
                for field in value.EnumerateObject() {
                    if !names.Add(field.Name) {
                        throw CliFailure("invalid_state", "Duplicate JSON key")
                    }

                    Unique(field.Value)
                }
            } else if value.ValueKind == JsonValueKind.Array {
                for item in value.EnumerateArray() {
                    Unique(item)
                }
            }
        }

        internal func Keys(value JsonElement, names string) {
            if value.ValueKind != JsonValueKind.Object {
                throw CliFailure("invalid_state", "Expected one strict JSON object")
            }

            let allowed = HashSet[string](names.Split(','), StringComparer.Ordinal)

            for field in value.EnumerateObject() {
                if field.Name == "" || !allowed.Contains(field.Name) {
                    throw CliFailure("invalid_state", "Unknown or authority-granting request field")
                }
            }
        }

        internal func Canonical(value JsonElement) string {
            if value.ValueKind == JsonValueKind.Object {
                let sorted = SortedDictionary[string, JsonElement](StringComparer.Ordinal)
                for field in value.EnumerateObject() {
                    sorted.Add(field.Name, field.Value)
                }

                let fields = List[string]()

                for field in sorted {
                    fields.Add(J.Write(field.Key) + ":" + Canonical(field.Value))
                }

                return "{" + String.Join(",", fields) + "}"
            }

            if value.ValueKind == JsonValueKind.Array {
                let items = List[string]()

                for item in value.EnumerateArray() {
                    items.Add(Canonical(item))
                }

                return "[" + String.Join(",", items) + "]"
            }

            if value.ValueKind == JsonValueKind.String {
                return J.Write(value.GetString() ?? "")
            }

            if value.ValueKind == JsonValueKind.Number {
                var integer int64
                if !value.TryGetInt64(out integer) {
                    throw CliFailure("invalid_state", "Only integer metadata is supported")
                }

                return integer.ToString(System.Globalization.CultureInfo.InvariantCulture)
            }

            return value.GetRawText()
        }

        internal func Token(value string, message string = "Invalid tool identifier") string {
            if !Regex.IsMatch(value, "^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$") {
                throw CliFailure("invalid_state", message)
            }

            return value
        }

        internal func Identifier(text string, model bool = false) string {
            if text == "" && !model {
                return "unknown"
            }

            let pattern = model ? RequestData.ModelPattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$"

            if !Regex.IsMatch(text, pattern) || text.Contains("://") || Regex.IsMatch(
                text,
                "(?i)(gh[pousr]_|github_pat_|sk-|secret|password)"
            ) {
                throw CliFailure("invalid_state", "Tool declaration contains an invalid public identifier")
            }

            return text
        }

        internal func ModelIdentifier(value string) string -> Identifier(value, model: true)
    }
}

internal class ToolDeclaration(
    source JsonElement,
    harness string,
    provider string,
    model string,
    effort string,
    codingSeconds int64?,
    invalidCodingTime bool,
    usage JsonElement
) {
    private let Source JsonElement = source
    internal let Harness string = harness
    internal let Provider string = provider
    internal let Model string = model
    internal let Effort string = effort
    internal let CodingSeconds int64? = codingSeconds
    internal let InvalidCodingTime bool = invalidCodingTime
    internal let Usage JsonElement = usage

    internal func Write(writer Utf8JsonWriter) {
        writer.WriteStartObject()

        for field in Source.EnumerateObject() {
            if field.Name == "usage" && field.Value.ValueKind != JsonValueKind.Null {
                writer.WritePropertyName(field.Name)
                RequestUsage.Parse(field.Value).Write(writer)
            } else {
                field.WriteTo(writer)
            }
        }

        writer.WriteEndObject()
    }

    shared {
        internal func WriteAll(writer Utf8JsonWriter, value JsonElement) {
            writer.WriteStartArray()

            for item in value.EnumerateArray() {
                Parse(item).Write(writer)
            }

            writer.WriteEndArray()
        }

        internal func Parse(value JsonElement) ToolDeclaration {
            RequestData.Keys(value, "harness,provider,model,effort,usage,coding_seconds")

            let number = J.Get(value, "coding_seconds")
            let present = number.ValueKind != JsonValueKind.Undefined && number.ValueKind != JsonValueKind.Null
            var seconds int64
            let valid = !present || (number.ValueKind == JsonValueKind.Number && number.TryGetInt64(out seconds))
            let codingSeconds int64? = present && valid ? seconds as int64?: nil

            return ToolDeclaration(
                value,
                JsonFields.String(value, "Request tool", "harness"),
                JsonFields.String(value, "Request tool", "provider"),
                JsonFields.String(value, "Request tool", "model"),
                JsonFields.String(value, "Request tool", "effort"),
                codingSeconds,
                !valid,
                J.Get(value, "usage")
            )
        }
    }
}

internal class RequestUsage(source JsonElement, inputTokens int64, cachedInputTokens int64, outputTokens int64) {
    private let Source JsonElement = source
    internal let InputTokens int64 = inputTokens
    internal let CachedInputTokens int64 = cachedInputTokens
    internal let OutputTokens int64 = outputTokens

    internal func Write(writer Utf8JsonWriter) -> Source.WriteTo(writer)

    shared {
        internal func Parse(value JsonElement) RequestUsage {
            RequestData.Keys(value, "input_tokens,cached_input_tokens,output_tokens")
            var input int64 = -1
            var cached int64 = -1
            var output int64 = -1

            for field in value.EnumerateObject() {
                var count int64

                if field.Value.ValueKind != JsonValueKind.Number || !field.Value.TryGetInt64(out count) || count < 0 {
                    throw CliFailure("invalid_state", "Usage must be a nonnegative donor-reported count")
                }

                switch field.Name {
                    case "input_tokens" {
                        input = count
                    }
                    case "cached_input_tokens" {
                        cached = count
                    }
                    default {
                        output = count
                    }
                }
            }

            return RequestUsage(value, input, cached, output)
        }
    }
}
