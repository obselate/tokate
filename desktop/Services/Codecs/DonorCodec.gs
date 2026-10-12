package TokateDesktop

import System
import System.Collections.Generic
import System.Text.Json

class DonorCodec {
    shared {
        func Profiles(data JsonElement) []DonorProfile {
            let profiles = Json.Get(data, "profiles")
            let result = List[DonorProfile]()
            if !Json.IsObject(profiles) {
                return result.ToArray()
            }
            for item in profiles.EnumerateObject() {
                result.Add(Selection(item.Value) with{Name = item.Name})
            }
            return result.ToArray()
        }

        func Selection(value JsonElement) DonorProfile -> DonorProfile{
            Name: "",
            Harness: Json.Text(value, "harness"),
            Provider: Json.Text(value, "provider"),
            Model: Json.Text(value, "model"),
            Effort: Json.Text(value, "effort"),
            Endpoint: Json.Text(value, "endpoint"),
        }

        /// The chat models that OMP lists, with the reasoning efforts that Tokate accepts for each.
        func OmpModels(value JsonElement) []ModelChoice {
            let result = List[ModelChoice]()
            for item in Json.Items(value, "models") {
                if Json.Text(item, "kind") != "chat" {
                    continue
                }
                let thinking = Json.Strings(item, "thinking")
                let efforts = List[string]{"absent"}
                if Json.Bool(item, "reasoning") && thinking.Length > 0 {
                    efforts.Clear()
                    efforts.Add("off")
                    efforts.AddRange(thinking)
                }
                result.Add(
                    ModelChoice{
                        Slug: Json.Text(item, "id"),
                        DisplayName: Json.Text(item, "id"),
                        Efforts: efforts.ToArray(),
                        Provider: Json.Text(item, "provider"),
                    }
                )
            }
            return result.ToArray()
        }

        /// Whether the doctor report shows `harness` as ready. A report without the harness counts as ready.
        func HarnessReady(data JsonElement, harness string) bool {
            for tool in Json.Items(data, "tools") {
                if Json.Text(tool, "name") == harness {
                    return Json.Text(tool, "status") == "ready"
                }
            }
            return true
        }

        func CodexModels(value JsonElement) []ModelChoice {
            let result = List[ModelChoice]()
            for item in Json.Items(value, "models") {
                let efforts = List[string]()
                for level in Json.Items(item, "supported_reasoning_levels") {
                    efforts.Add(Json.Text(level, "effort"))
                }
                result.Add(
                    ModelChoice{
                        Slug: Json.Text(item, "slug"),
                        DisplayName: Json.Text(item, "display_name"),
                        Efforts: efforts.ToArray(),
                        Hidden: Json.Text(item, "visibility") == "hide",
                        Provider: "",
                    }
                )
            }
            return result.ToArray()
        }
    }
}
