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
            let toolModels = List[ToolAllowance]()
            for tool in Json.Items(value, "allowed_tools") {
                let harness = Json.Text(tool, "harness")
                let provider = Json.Text(tool, "provider")
                tools.Add(harness)
                let pair = harness + "/" + (provider != "" ? provider: HarnessOption.ProviderOf(harness))
                providers.Add(pair)
                let allowances = List[ModelAllowance]()
                let toolEntries = Json.Get(tool, "models")
                if Json.IsObject(toolEntries) {
                    for model in toolEntries.EnumerateObject() {
                        allowances.Add(ModelAllowance{Model: model.Name, Efforts: Json.Strings(model.Value)})
                    }
                }
                toolModels.Add(ToolAllowance{
                    Tool: pair, Models: allowances.ToArray(), Restricted: Json.IsObject(toolEntries),
                    Command: Json.Strings(tool, "command"), Output: Json.Text(tool, "output"),
                })
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
                Eligibility: Json.Text(value, "eligibility") == "manual" ? "trusted": Json.Text(value, "eligibility"),
                AllowedTools: tools.ToArray(),
                ToolProviders: providers.ToArray(),
                ToolModels: toolModels.ToArray(),
            }
        }

        func FromPolicyResult(data JsonElement) Policy -> Policy(Json.Get(data, "policy"))

        func Setup(data JsonElement) SetupReport {
            let changes = List[SetupChange]()
            for change in Json.Items(data, "changes") {
                changes.Add(SetupChange{
                    Setting: Json.Text(change, "change"),
                    Current: Json.Text(change, "old"), Proposed: Json.Text(change, "new"),
                })
            }
            return SetupReport{
                Applied: Json.Bool(data, "applied"), Changes: changes.ToArray(),
                Manual: Json.Strings(data, "manual"), PullRequest: Json.Text(data, "pull_request"),
            }
        }

        func OwnerHealth(data JsonElement) string {
            let lines = List[string]()
            for tool in Json.Items(data, "tools") {
                lines.Add(Json.Text(tool, "name") + ": " + Json.Text(tool, "status") + "\n" + Json.Text(tool, "detail"))
                let hint = Json.Text(tool, "hint")
                if Json.Text(tool, "status") != "ready" && hint != "" {
                    lines.Add(hint)
                }
            }
            for check in Json.Items(data, "checks") {
                lines.Add(Json.Text(check, "check").Replace('_', ' ') + ": " + Json.Text(check, "status") + "\n" + Json.Text(check, "message"))
                let command = Json.Strings(check, "command")
                if command.Length > 0 {
                    lines.Add(String.Join(" ", command))
                }
            }
            return String.Join("\n\n", lines)
        }
    }
}
