package TokateDesktop

import System
import System.Collections.Generic
import System.Text.Json

class DonorCodec {
    shared {
        func Session(data JsonElement) DonationSession {
            let tasks = List[DonationTask]()
            for task in Json.Items(data, "tasks") {
                tasks.Add(DonationTask{
                    Issue: Json.Text(task, "issue"),
                    Result: Json.Text(task, "result"),
                    Reason: Json.Text(task, "error") != "" ? Json.Text(task, "error"): Json.Text(task, "reason"),
                    PullRequest: Json.Text(task, "pr_url"),
                    Directory: Json.Text(task, "run_directory"),
                })
            }
            return DonationSession{
                Repository: Json.Text(data, "repo"),
                Reason: Json.Text(data, "reason"),
                Submitted: Json.Int(data, "submitted"),
                Skipped: Json.Int(data, "skipped"),
                Failed: Json.Int(data, "failed"),
                Usage: Usage(Json.Get(data, "usage")),
                WallSeconds: WallTime(Json.Text(data, "wall_seconds")),
                Tasks: tasks.ToArray(),
            }
        }

        private func Tokens(count int64) string -> count >= 1000000 ? (float64(count) / 1000000).ToString("0.0") + "M": count >= 1000 ? (float64(count) / 1000).ToString("0.0") + "K": count.ToString()

        func Usage(value JsonElement) string -> Json.IsObject(value) ?
            Tokens((Json.Long(value, "input_tokens") ?? 0) + (Json.Long(value, "output_tokens") ?? 0)): "Not reported"

        func WallTime(value string) string {
            if !float64.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var seconds) {
                return "Not reported"
            }
            return seconds < 60 ? seconds.ToString("0.#") + " s": seconds < 3600 ? (int32(seconds) / 60).ToString() + " min " + (int32(seconds) % 60).ToString() + " s": (int32(seconds) / 3600).ToString() + " h " + (int32(seconds) / 60 % 60).ToString() + " min"
        }

        /// The saved profiles. Tokate stores the default as a copy without a name, so a profile with the same
        /// harness, provider, model and effort is the default.
        func Profiles(data JsonElement) []DonorProfile {
            let profiles = Json.Get(data, "profiles")
            let result = List[DonorProfile]()
            if !Json.IsObject(profiles) {
                return result.ToArray()
            }
            let chosen = Selection(Json.Get(data, "default"))
            for item in profiles.EnumerateObject() {
                let profile = Selection(item.Value)
                result.Add(
                    profile with{
                        Name = item.Name,
                        Default = chosen.Harness != "" && profile.Harness == chosen.Harness && profile.Provider == chosen.Provider &&
                            profile.Model == chosen.Model &&
                            profile.Effort == chosen.Effort,
                    }
                )
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
