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
            Model: Json.Text(value, "model"),
            Effort: Json.Text(value, "effort"),
            Endpoint: Json.Text(value, "endpoint"),
        }

        func CodexModels(value JsonElement) []CodexModel {
            let result = List[CodexModel]()
            for item in Json.Items(value, "models") {
                let efforts = List[string]()
                for level in Json.Items(item, "supported_reasoning_levels") {
                    efforts.Add(Json.Text(level, "effort"))
                }
                result.Add(
                    CodexModel{
                        Slug: Json.Text(item, "slug"),
                        DisplayName: Json.Text(item, "display_name"),
                        Efforts: efforts.ToArray(),
                        Hidden: Json.Text(item, "visibility") == "hide",
                    }
                )
            }
            return result.ToArray()
        }
    }
}
