package TokateDesktop

import System
import System.Collections.Generic
import System.Text.Json

class PolicyCodec {
    shared {
        func Policy(value JsonElement) Policy {
            let commands = List[[]string]()
            for command in Json.Items(value, "verification") {
                commands.Add(Json.Strings(command))
            }
            let models = List[ModelAllowance]()
            let entries = Json.Get(value, "models")
            if Json.IsObject(entries) {
                for model in entries.EnumerateObject() {
                    models.Add(ModelAllowance{Model: model.Name, Efforts: Json.Strings(model.Value)})
                }
            }
            let tools = List[string]()
            let providers = List[string]()
            for tool in Json.Items(value, "allowed_tools") {
                let harness = Json.Text(tool, "harness")
                let provider = Json.Text(tool, "provider")
                tools.Add(harness)
                providers.Add(harness + "/" + (provider != "" ? provider: HarnessOption.ProviderOf(harness)))
            }
            return Policy{
                Loaded: Json.IsObject(value),
                Version: Json.Int(value, "version"),
                MaxSeconds: Json.Int(value, "max_seconds"),
                AllowUnlimited: Json.Bool(value, "allow_unlimited"),
                TargetBranch: Json.Text(value, "target_branch"),
                RequiredChecks: Json.Strings(value, "required_checks"),
                Verification: commands.ToArray(),
                Models: models.ToArray(),
                ModelPolicy: Json.Text(value, "model_policy"),
                Eligibility: Json.Text(value, "eligibility"),
                AllowedTools: tools.ToArray(),
                ToolProviders: providers.ToArray(),
            }
        }

        func FromPolicyResult(data JsonElement) Policy -> Policy(Json.Get(data, "policy"))
    }
}
