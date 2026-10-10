package TokateDesktop

import Gsharp.Extensions.Json
import System
import System.Collections.Generic
import System.IO
import System.Text
import System.Text.Json

func Field(value JsonElement, key string) JsonElement {
    var result JsonElement
    if value.ValueKind == JsonValueKind.Object && value.TryGetProperty(key, out result) {
        return result
    }
    return JsonElement{}
}

func TextOf(value JsonElement, key string) string {
    let item = Field(value, key)
    if item.ValueKind == JsonValueKind.String {
        return item.GetString() ?? ""
    }
    return item.ValueKind == JsonValueKind.Number ? item.ToString(): ""
}

func Number(value JsonElement, key string) int32 {
    let item = Field(value, key)
    var number int32
    return item.ValueKind == JsonValueKind.Number && item.TryGetInt32(out number) ? number: 0
}

func Items(value JsonElement) List[JsonElement] {
    let result = List[JsonElement]()
    if value.ValueKind == JsonValueKind.Array {
        for item in value.EnumerateArray() {
            result.Add(item)
        }
    }
    return result
}

func Repository(value string) string {
    let trimmed = value.Trim().TrimEnd('/')
    let repo = trimmed.StartsWith("https://github.com/", StringComparison.OrdinalIgnoreCase) ? trimmed.Substring(
        19
    ): trimmed
    let parts = repo.Split('/')
    if parts.Length != 2 && !(parts.Length == 4 && parts[2] == "issues") {
        throw Exception("Enter owner/repository or a GitHub issue URL.")
    }
    for part in[]string{parts[0], parts[1]} {
        if part.Length == 0 || part.StartsWith("-") || part == "." || part == ".." {
            throw Exception("Enter a valid GitHub repository.")
        }
        for c in part {
            if !Char.IsAsciiLetterOrDigit(c) && c != '-' && c != '_' && c != '.' {
                throw Exception("Enter a valid GitHub repository.")
            }
        }
    }
    return parts[0] + "/" + parts[1]
}

class Json {
    shared {
        let MaxLength int32 = 1048576

        func Parse(text string) JsonElement {
            if text.Length > MaxLength {
                throw Exception("JSON input exceeds the size limit.")
            }
            using let document = JsonDocument.Parse(text)
            return document.RootElement.Clone()
        }

        func ParseFile(path string) JsonElement {
            if FileInfo(path).Length > MaxLength {
                throw Exception("JSON file exceeds the size limit.")
            }
            return Parse(File.ReadAllText(path))
        }

        func IsObject(value JsonElement) bool -> value.ValueKind == JsonValueKind.Object

        func Get(value JsonElement, key string) JsonElement {
            var result JsonElement
            if value.ValueKind == JsonValueKind.Object && value.TryGetProperty(key, out result) {
                return result
            }
            return JsonElement{}
        }

        func Text(value JsonElement, key string) string {
            let item = Get(value, key)
            if item.ValueKind == JsonValueKind.Number {
                return item.ToString()
            }
            return value.GetStringOrNil(key) ?? ""
        }

        func Int(value JsonElement, key string) int32 -> value.GetInt32OrNil(key) ?? 0

        func Long(value JsonElement, key string) int64? -> value.GetInt64OrNil(key)

        func Bool(value JsonElement, key string) bool -> value.GetBoolOrNil(key) ?? false

        func BoolOrNil(value JsonElement, key string) bool? -> value.GetBoolOrNil(key)

        func Items(value JsonElement) []JsonElement {
            let result = List[JsonElement]()
            if value.ValueKind == JsonValueKind.Array {
                for item in value.EnumerateArray() {
                    result.Add(item)
                }
            }
            return result.ToArray()
        }

        func Items(value JsonElement, key string) []JsonElement -> Items(Get(value, key))

        func Strings(value JsonElement) []string {
            let result = List[string]()
            for item in Items(value) {
                result.Add(item.ValueKind == JsonValueKind.String ? item.GetString() ?? "": "")
            }
            return result.ToArray()
        }

        func Strings(value JsonElement, key string) []string -> Strings(Get(value, key))

        func Raw(value JsonElement) string -> value.ValueKind == JsonValueKind.Undefined ? "": value.ToString()

        func StringArray(values IEnumerable[string]) string -> Write(writer -> WriteStrings(writer, values))

        func NestedArrays(values IEnumerable[[]string]) string -> Write(
            writer -> {
                writer.WriteStartArray()
                for value in values {
                    WriteStrings(writer, value)
                }
                writer.WriteEndArray()
            }
        )

        func StringListMap(values []ModelAllowance) string -> Write(
            writer -> {
                writer.WriteStartObject()
                for value in values {
                    writer.WritePropertyName(value.Model)
                    WriteStrings(writer, value.Efforts)
                }
                writer.WriteEndObject()
            }
        )

        private func WriteStrings(writer Utf8JsonWriter, values IEnumerable[string]) {
            writer.WriteStartArray()
            for value in values {
                writer.WriteStringValue(value)
            }
            writer.WriteEndArray()
        }

        private func Write(body Action[Utf8JsonWriter]) string {
            using let bytes = MemoryStream()
            using let writer = Utf8JsonWriter(bytes)
            body(writer)
            writer.Flush()
            return Encoding.UTF8.GetString(bytes.ToArray())
        }
    }
}
