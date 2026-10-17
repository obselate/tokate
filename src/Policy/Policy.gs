package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Linq
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

internal class Policy {
    internal var Value JsonElement
    internal var Digest string = ""
    internal var Tools JsonElement
    internal var Eligibility string = ""
    internal var TaskFields JsonElement
    internal var MaintainerEdits bool = true
    internal var MaxSeconds int32
    internal var Version int64
    internal var TargetBranch string = ""
    internal var PrText string = ""
    internal var ReservationSeconds int32
    internal var Verification JsonElement
    internal var RequiredChecks JsonElement
    internal var ProtectedPaths JsonElement
    internal var AllowUnlimited bool
    internal var CloseMessage string = ""
    internal var ApprovalScope string = ""
    internal let AllowedTools List[AllowedTool] = List[AllowedTool]()

    internal init(text string) {
        Value = RequestData.Parse(text, FileByteLimit)
        Configure()
    }

    internal init(value JsonElement) {
        Value = value
        Configure()
    }

    private func Configure() {
        Version = JsonFields.Int64(Value, "Policy", "version")

        if Version != 3 {
            throw Exception("Policy requires version 3")
        }

        TargetBranch = JsonFields.OptionalString(Value, "Policy", "target_branch", "")
        PrText = JsonFields.OptionalString(Value, "Policy", "pr_text", "")
        CloseMessage = JsonFields.OptionalString(
            Value,
            "Policy",
            "close_message",
            "This pull request lacks current owner authorization. Please request owner approval."
        )
        Verification = OptionalArray("verification")
        RequiredChecks = OptionalArray("required_checks")
        ProtectedPaths = OptionalArray("protected_paths")
        AllowUnlimited = JsonFields.OptionalBool(Value, "Policy", "allow_unlimited", false)
        MaintainerEdits = JsonFields.OptionalBool(Value, "Policy", "maintainer_edits", true)
        ApprovalScope = JsonFields.String(Value, "Policy", "approval_scope")

        ValidateTextFields()
        Tokate.ProtectedPaths.Validate(ProtectedPaths)

        var eligibilityFields int32
        var scopeFields int32

        for field in Value.EnumerateObject() {
            if field.Name == "eligibility" {
                eligibilityFields++
            }

            if field.Name == "approval_scope" {
                scopeFields++
            }
        }

        RequestData.Parse(J.Write(Value), FileByteLimit)
        Eligibility = JsonFields.String(Value, "Policy", "eligibility")
        let eligible = Eligibility == "open" || Eligibility == "trusted"

        if eligibilityFields != 1 || scopeFields != 1 || ApprovalScope != "task" || !eligible {
            throw Exception("Policy requires approval_scope task and eligibility trusted or open")
        }

        var obsolete JsonElement
        if Value.TryGetProperty("models", out obsolete) || Value.TryGetProperty("model_policy", out obsolete) {
            throw Exception("Version 3 uses models inside allowed_tools, without top-level models or model_policy")
        }

        MaxSeconds = JsonFields.Int32(Value, "Policy", "max_seconds")

        if MaxSeconds < 1 || MaxSeconds > RuntimeBudget.MaxBudgetSeconds {
            throw Exception("Set models and a max_seconds limit from 1 to 86400")
        }

        let commands = J.Items(Verification)

        for command in commands {
            let words = J.Items(command)
            if words.Count == 0 {
                throw Exception("Verification commands must be argv arrays")
            }

            for word in words {
                if word.ValueKind != JsonValueKind.String || String.IsNullOrWhiteSpace(word.GetString()) {
                    throw Exception("Invalid verification argument")
                }
            }
        }

        let checks = J.Items(RequiredChecks)

        for check in checks {
            if check.ValueKind != JsonValueKind.String || String.IsNullOrWhiteSpace(check.GetString()) {
                throw Exception("Invalid required check name")
            }
        }

        let reservation = JsonFields.OptionalInt64(Value, "Policy", "reservation_seconds", 86400)
        if reservation < 300 || reservation > 604800 {
            throw Exception("reservation_seconds must be from 300 to 604800 (default 86400)")
        }

        ReservationSeconds = int32(reservation)

        ValidateAllowedTools()

        using let bytes = MemoryStream()
        using let writer = Utf8JsonWriter(bytes)
        writer.WriteStartObject()
        for field in[]string{"verification", "required_checks", "protected_paths"} {
            writer.WriteStartArray(field)
            let items = field == "verification" ? commands: field == "required_checks" ? checks: J.Items(ProtectedPaths)
            for item in items {
                item.WriteTo(writer)
            }
            writer.WriteEndArray()
        }
        writer.WritePropertyName("allowed_tools")
        Tools.WriteTo(writer)
        writer.WriteNumber("max_seconds", MaxSeconds)
        writer.WriteBoolean("allow_unlimited", AllowUnlimited)
        writer.WriteNumber("reservation_seconds", ReservationSeconds)

        var edits JsonElement
        if Value.TryGetProperty("maintainer_edits", out edits) {
            writer.WriteBoolean("maintainer_edits", MaintainerEdits)
        }
        writer.WriteEndObject()
        writer.Flush()
        TaskFields = J.Parse(Encoding.UTF8.GetString(bytes.ToArray()))
        Digest = J.Hash(RequestData.Canonical(TaskFields))
    }

    private func OptionalArray(field string) JsonElement {
        var item JsonElement
        return Value.TryGetProperty(field, out item) ? JsonFields.Array(Value, "Policy", field): JsonElement{}
    }

    private func ValidateTextFields() {
        for key in[]string{"pr_text", "close_message", "target_branch"} {
            var occurrences int32

            for field in Value.EnumerateObject() {
                if field.Name == key {
                    occurrences++
                }
            }

            if occurrences > 1 {
                throw Exception("Duplicate policy field " + key)
            }

            var item JsonElement
            if Value.TryGetProperty(key, out item) {
                let text = JsonFields.String(Value, "Policy", key)
                if Encoding.UTF8.GetByteCount(text) > 4096 {
                    throw Exception(key + " must be bounded plain text")
                }

                for c in text {
                    if c == '\0' || (Char.IsControl(c) && c != '\n' && c != '\r' && c != '\t') {
                        throw Exception(key + " contains control characters")
                    }
                }

                if text.Contains("<!-- tokate") {
                    throw Exception(key + " cannot contain Tokate ownership markers")
                }

                if key == "target_branch" {
                    RepositoryIdentity.Branch(text)
                }
            }
        }
    }

    private func ValidateAllowedTools() {
        Tools = JsonFields.Array(Value, "Policy", "allowed_tools")
        let allowedTools = J.Items(Tools)
        if allowedTools.Count == 0 {
            throw Exception("Policy requires allowed_tools harness/provider pairs")
        }

        let pairs = HashSet[string](StringComparer.Ordinal)

        for value in allowedTools {
            let tool = AllowedTool.Parse(value)
            AllowedTools.Add(tool)
            if tool.Harness == "" || tool.Provider == "" {
                throw Exception("Each allowed tool needs harness and provider")
            }

            if !pairs.Add(tool.Harness + "/" + tool.Provider) {
                throw Exception("Duplicate allowed tool harness/provider pair")
            }

            if tool.Harness == "command" {
                CommandHarness.Validate(tool.Command, tool.Output, tool.Models != nil)
            }
        }
    }

    internal func Tool(harness string, provider string) AllowedTool? -> AllowedTools.Find(
        tool -> tool.Harness == harness && tool.Provider == provider
    )

    internal func Adapter(harness string, provider string) Harness? {
        if harness == "command" {
            if let tool = Tool(harness, provider) {
                return CommandHarness.Adapter(tool.Command, tool.Output)
            }
        }

        return Harness.Find(harness)
    }

    internal func ToolModels(harness string, provider string) Dictionary[string, List[string]]? -> Tool(
        harness,
        provider
    )?.Models

    internal func Unrestricted(harness string, provider string) bool -> AllowsTool(harness, provider) &&
        ToolModels(harness, provider) == nil

    internal func Allows(harness string, provider string, model string, effort string) bool {
        try {
            Validate(harness, provider, model, effort, 1)
            return true
        } catch (error Exception) {
            return false
        }
    }

    internal func AllowsModel(harness string, provider string, model string) bool {
        try {
            Validate(harness, provider, model, "", 1, external: true, modelOnly: true)
            return true
        } catch (error Exception) {
            return false
        }
    }

    internal func AllowedModels(harness string, provider string, pattern string) List[string]? {
        if Unrestricted(harness, provider) {
            return nil
        }

        let entries = ToolModels(harness, provider)
        return entries?.Keys.Where(entry -> Regex.IsMatch(entry, pattern)).ToList() ?? List[string]()
    }

    internal func Validate(
        harness string,
        provider string,
        model string,
        effort string,
        seconds int32,
        external bool = false,
        modelOnly bool = false
    ) {
        RequestData.Token(provider)
        RequestData.ModelIdentifier(model)
        if !modelOnly && !ValidEffort(effort) {
            throw Exception("Invalid model name or reasoning effort. No inference started.")
        }

        if !AllowsTool(harness, provider) {
            throw Exception("Declared harness/provider is not allowed by owner policy. No inference started.")
        }

        if !external {
            let adapter = Adapter(harness, provider)
            let catalog = adapter?.Catalog == true
            if model == "unknown" ||
                effort == "unknown" ||
                (
                catalog ? effort == "ultra": effort == "absent" || !Regex.IsMatch(model, "^[A-Za-z0-9][A-Za-z0-9._-]*$")
            ) {
                throw Exception(
                    "Tokate-managed execution requires a known model and supported effort control. No inference started."
                )
            }

            if adapter?.Pair is Func[string, string, bool]pair &&
                (!Harness.Accepts(harness, provider) || !pair(model, effort)) {
                throw Exception("Unsupported native Claude model/effort pair. No inference started.")
            }

            if adapter == nil || (adapter.Provider != "" && adapter.Provider != provider) {
                throw Exception("Unsupported managed harness/provider pair. No inference started.")
            }
        }

        if let models = ToolModels(harness, provider) {
            var efforts List[string]
            if !models.TryGetValue(model, out efforts) || !efforts.Exists(item -> modelOnly || item == effort) {
                throw Exception("Model/effort pair is not allowed by the repository policy. No inference started.")
            }
        }

        ValidateBudget(seconds)
    }

    internal func ValidateBudget(seconds int32, unlimited bool = false) {
        if unlimited && !AllowUnlimited {
            throw Exception("Repository policy does not allow unlimited coding")
        }

        let maximum = MaxSeconds
        if seconds < 1 || seconds > maximum {
            throw CliFailure(
                "invalid_arguments",
                "Requested --time " + seconds.ToString() + "s is invalid. Policy maximum: " + maximum.ToString() +
                    "s. Choose --time from 1s to " +
                    maximum.ToString() + "s."
            )
        }
    }

    internal func ValidateTools(tools JsonElement, source string = "external") {
        let declarations = J.Items(tools)
        if declarations.Count == 0 {
            throw Exception("Policy needs a nonempty tool declaration")
        }

        if source != "external" && source != "tokate" {
            throw Exception("Invalid contribution source")
        }

        if source == "tokate" && declarations.Count != 1 {
            throw Exception(
                "Managed execution supports one codex/openai, claude/anthropic, pi/local-chat-completions or omp declaration"
            )
        }

        for tool in declarations {
            let declaration = ToolDeclaration.Parse(tool)
            Validate(
                declaration.Harness,
                declaration.Provider,
                declaration.Model,
                declaration.Effort,
                1,
                source == "external"
            )
        }
    }

    internal func Providers(harness string) List[string] -> AllowedTools
        .Where(tool -> tool.Harness == harness)
        .Select(tool -> tool.Provider)
        .Distinct(StringComparer.Ordinal)
        .ToList()

    internal func AllowsTool(harness string, provider string) bool -> Tool(harness, provider) != nil

    shared {
        internal const FileByteLimit int32 = 1024 * 1024

        internal const FilePath string = ".github/tokate.json"

        private func ValidEffort(effort string) bool -> Array.IndexOf(
            "off minimal low medium high xhigh max ultra unknown absent".Split(' '),
            effort
        ) >= 0

        internal func Load(repo string, revision string) Policy -> Policy(GitHub.FileAt(repo, FilePath, revision))

        internal func Parse(value JsonElement) Policy -> Policy(value)
    }

    internal class AllowedTool(
        harness string,
        provider string,
        models Dictionary[string, List[string]]?,
        command JsonElement,
        output string
    ) {
        internal let Harness string = harness
        internal let Provider string = provider
        internal let Models Dictionary[string, List[string]]? = models
        internal let Command JsonElement = command
        internal let Output string = output

        shared {
            internal func Parse(value JsonElement) AllowedTool {
                let harness = JsonFields.String(value, "Policy allowed tool", "harness")
                let provider = JsonFields.String(value, "Policy allowed tool", "provider")
                var models JsonElement
                value.TryGetProperty("models", out models)
                var command JsonElement
                value.TryGetProperty("command", out command)
                let output = J.Get(value, "output").ValueKind == JsonValueKind.Null ? "":
                JsonFields.OptionalString(value, "Policy allowed tool", "output", "")

                return AllowedTool(harness, provider, ParseModels(models), command, output)
            }

            private func ParseModels(value JsonElement) Dictionary[string, List[string]]? {
                if value.ValueKind == JsonValueKind.Undefined {
                    return nil
                }
                if value.ValueKind != JsonValueKind.Object {
                    throw Exception("Policy models must map model names to effort arrays")
                }

                let models = map[string, List[string]]{}
                for model in value.EnumerateObject() {
                    if !Regex.IsMatch(model.Name, RequestData.ModelPattern) {
                        throw Exception("Invalid model name")
                    }

                    let values = JsonFields.Array(value, "Policy models", model.Name)
                    if values.GetArrayLength() == 0 {
                        throw Exception("Each model needs allowed efforts")
                    }
                    let efforts = List[string](values.GetArrayLength())
                    for effort in values.EnumerateArray() {
                        if effort.ValueKind != JsonValueKind.String || !ValidEffort(effort.GetString() ?? "") {
                            throw Exception("Invalid reasoning effort")
                        }
                        efforts.Add(effort.GetString() ?? "")
                    }
                    models.Add(model.Name, efforts)
                }

                if models.Count == 0 {
                    throw Exception("Set models and a max_seconds limit from 1 to 86400")
                }

                return models
            }
        }
    }
}
