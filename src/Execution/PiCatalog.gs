package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json
import System.Text.RegularExpressions

internal class PiCatalog {
    shared {
        internal func Read(node string, model string, endpoint string, budget RuntimeBudget? = nil) JsonElement {
            let storage = Directory.CreateDirectory(
                Path.Combine("/tmp", "tokate-pi-catalog-" + Guid.NewGuid().ToString("N")),
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
            )
            try {
                let script = Path.Combine(storage.FullName, "catalog.mjs")
                File.WriteAllText(script, ApplicationInfo.Resource("pi-catalog.mjs"))
                let result = Commands.Run(
                    node,
                    []string{script},
                    storage.FullName,
                    input: PiBoundary.Endpoint(endpoint),
                    seconds: 10,
                    isolated: true,
                    budget: budget
                )
                if result.Code != 0 || result.Truncated || result.ReadFailed {
                    throw Exception("Endpoint metadata unavailable")
                }
                return Identity(RequestData.Parse(result.Output, 1024 * 1024), model)
            } catch (error Exception) {
                throw CliFailure("endpoint_unavailable", PublicOutput.Message("endpoint_unavailable"))
            } finally {
                Directory.Delete(storage.FullName, true)
            }
        }

        private func Identity(catalog JsonElement, model string) JsonElement {
            let list = J.Get(catalog, "data")
            if catalog.ValueKind != JsonValueKind.Object ||
                list.ValueKind != JsonValueKind.Array ||
                list.GetArrayLength() > 4096 {
                throw Exception("Invalid model list")
            }
            let kind = J.Get(catalog, "object")
            if kind.ValueKind != JsonValueKind.Undefined && J.Text(catalog, "object") != "list" {
                throw Exception("Invalid model list type")
            }
            let seen = HashSet[string](StringComparer.Ordinal)
            var selected JsonElement
            for entry in list.EnumerateArray() {
                let id = RequestData.ModelIdentifier(J.Text(entry, "id"))
                if id != id.Trim() || !seen.Add(id) {
                    throw Exception("Invalid or duplicate model id")
                }
                if id == model {
                    selected = entry
                }
            }
            if selected.ValueKind != JsonValueKind.Object {
                throw Exception("Selected model not advertised")
            }
            let result = map[string, Object?]{"advertised_model": model}
            for name in[]string{"runtime_version", "digest", "quantization", "context_window", "supports_tools"} {
                if name == "context_window" {
                    result[name] = Context(selected)
                    continue
                }
                let field = J.Get(selected, name)
                if field.ValueKind == JsonValueKind.Undefined || field.ValueKind == JsonValueKind.Null {
                    result[name] = "unknown"
                    continue
                }
                let valid = name == "supports_tools" ?
                field.ValueKind == JsonValueKind.True || field.ValueKind == JsonValueKind.False:
                field.ValueKind == JsonValueKind.String && Regex.IsMatch(
                    field.GetString() ?? "",
                    "^[A-Za-z0-9][A-Za-z0-9._:+-]{0,199}\\z"
                )
                if !valid {
                    throw Exception("Invalid model identity")
                }
                result[name] = field
            }
            return J.Parse(J.Write(result))
        }

        private func Context(selected JsonElement) Object {
            var reported int32 = 0
            for name in[]string{"context_window", "context_length"} {
                let field = J.Get(selected, name)
                if field.ValueKind == JsonValueKind.Undefined || field.ValueKind == JsonValueKind.Null {
                    continue
                }
                var context int32
                if field.ValueKind != JsonValueKind.Number || !field.TryGetInt32(out context) ||
                    context <= 0 ||
                    (reported != 0 && reported != context) {
                    throw Exception("Invalid model identity")
                }
                reported = context
            }
            if reported == 0 {
                return "unknown"
            }
            return reported
        }
    }
}
