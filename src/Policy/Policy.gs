package Tokate

import System
import System.Collections.Generic
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

    internal init(text string) {
        Value = J.Parse(text)
        let version = J.Number(Value, "version")

        if version != 3 {
            throw Exception("Policy requires version 3")
        }

        ValidateTextFields()
        ProtectedPaths.Validate(J.Get(Value, "protected_paths"))

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

        RequestData.Parse(text, 1024 * 1024)
        Eligibility = J.Text(Value, "eligibility")
        let eligible = Eligibility == "open" || Eligibility == "trusted"

        if eligibilityFields != 1 || scopeFields != 1 || J.Text(Value, "approval_scope") != "task" || !eligible {
            throw Exception("Policy requires approval_scope task and eligibility trusted or open")
        }

        if J.Get(Value, "models").ValueKind != JsonValueKind.Undefined || J.Get(Value, "model_policy")
            .ValueKind != JsonValueKind
            .Undefined {
            throw Exception("Version 3 uses models inside allowed_tools, without top-level models or model_policy")
        }

        let maxSeconds = J.Number(Value, "max_seconds")

        if maxSeconds < 1 || maxSeconds > 86400 {
            throw Exception("Set models and a max_seconds limit from 1 to 86400")
        }

        let unlimited = J.Get(Value, "allow_unlimited").ValueKind

        if unlimited != JsonValueKind.Undefined && unlimited != JsonValueKind.True && unlimited != JsonValueKind.False {
            throw Exception("allow_unlimited must be boolean")
        }

        if unlimited != JsonValueKind.Undefined {
            RequestData.Parse(text, 1024 * 1024)
        }

        let edits = J.Get(Value, "maintainer_edits")
        if edits.ValueKind != JsonValueKind.Undefined &&
            edits.ValueKind != JsonValueKind.True &&
            edits.ValueKind != JsonValueKind.False {
            throw Exception("maintainer_edits must be boolean")
        }

        MaintainerEdits = edits.ValueKind != JsonValueKind.False

        for key in[]string{"verification", "required_checks"} {
            let kind = J.Get(Value, key).ValueKind
            if kind != JsonValueKind.Undefined && kind != JsonValueKind.Array {
                throw Exception(key + " must be an array")
            }
        }

        let commands = J.Items(J.Get(Value, "verification"))

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

        let checks = J.Items(J.Get(Value, "required_checks"))

        for check in checks {
            if check.ValueKind != JsonValueKind.String || String.IsNullOrWhiteSpace(check.GetString()) {
                throw Exception("Invalid required check name")
            }
        }

        let reservation = J.Get(Value, "reservation_seconds")
        if reservation.ValueKind != JsonValueKind.Undefined &&
            (J.Number(Value, "reservation_seconds") < 300 || J.Number(Value, "reservation_seconds") > 604800) {
            throw Exception("reservation_seconds must be from 300 to 604800 (default 86400)")
        }

        ValidateAllowedTools()

        let task = map[string, Object?]{
            "verification": commands,
            "required_checks": checks,
            "protected_paths": J.Items(J.Get(Value, "protected_paths")),
            "allowed_tools": Tools,
            "max_seconds": maxSeconds,
            "allow_unlimited": J.Bool(Value, "allow_unlimited"),
            "reservation_seconds": reservation.ValueKind == JsonValueKind.Undefined ? 86400: J.Number(
                Value,
                "reservation_seconds"
            )
        }

        if edits.ValueKind != JsonValueKind.Undefined {
            task["maintainer_edits"] = MaintainerEdits
        }
        TaskFields = J.Parse(J.Write(task))
        Digest = J.Hash(RequestData.Canonical(TaskFields))
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

            let item = J.Get(Value, key)
            if item.ValueKind != JsonValueKind.Undefined {
                if item.ValueKind != JsonValueKind.String || Encoding.UTF8.GetByteCount(item.GetString() ?? "") > 4096 {
                    throw Exception(key + " must be bounded plain text")
                }

                let text = item.GetString() ?? ""

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
        let allowedTools = J.Items(J.Get(Value, "allowed_tools"))
        if allowedTools.Count == 0 {
            throw Exception("Policy requires allowed_tools harness/provider pairs")
        }

        let pairs = HashSet[string](StringComparer.Ordinal)

        for tool in allowedTools {
            if J.Text(tool, "harness") == "" || J.Text(tool, "provider") == "" {
                throw Exception("Each allowed tool needs harness and provider")
            }

            if !pairs.Add(J.Text(tool, "harness") + "/" + J.Text(tool, "provider")) {
                throw Exception("Duplicate allowed tool harness/provider pair")
            }

            let models = J.Get(tool, "models")
            if models.ValueKind != JsonValueKind.Undefined {
                ValidateModels(models)
            }

            if J.Text(tool, "harness") == "command" {
                CommandHarness.Validate(tool)
            }
        }

        Tools = J.Get(Value, "allowed_tools")
    }

    private func ValidateModels(models JsonElement) {
        if models.ValueKind != JsonValueKind.Object {
            throw Exception("Policy models must map model names to effort arrays")
        }

        var count int32
        for model in models.EnumerateObject() {
            if !Regex.IsMatch(model.Name, RequestData.ModelPattern) {
                throw Exception("Invalid model name")
            }

            let efforts = J.Items(model.Value)
            if efforts.Count == 0 {
                throw Exception("Each model needs allowed efforts")
            }

            for effort in efforts {
                if effort.ValueKind != JsonValueKind.String || !ValidEffort(effort.GetString() ?? "") {
                    throw Exception("Invalid reasoning effort")
                }
            }

            count++
        }

        if count == 0 {
            throw Exception("Set models and a max_seconds limit from 1 to 86400")
        }
    }

    internal func Tool(harness string, provider string) JsonElement -> J.Items(Tools).Find(
        tool -> J.Text(tool, "harness") == harness && J.Text(tool, "provider") == provider
    )

    internal func Adapter(harness string, provider string) Harness? -> harness == "command" ?
    CommandHarness.Adapter(Tool(harness, provider)): Harness.Find(harness)

    internal func ToolModels(harness string, provider string) JsonElement -> J.Get(Tool(harness, provider), "models")

    internal func Unrestricted(harness string, provider string) bool -> AllowsTool(harness, provider) && ToolModels(
        harness,
        provider
    ).ValueKind == JsonValueKind.Undefined

    private func ValidEffort(effort string) bool -> Array.IndexOf(
        "off minimal low medium high xhigh max ultra unknown absent".Split(' '),
        effort
    ) >= 0

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
        return entries.ValueKind == JsonValueKind.Object ?
        entries
            .EnumerateObject()
            .Where(entry -> Regex.IsMatch(entry.Name, pattern))
            .Select(entry -> entry.Name)
            .ToList():
        List[string]()
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

        let efforts = J.Items(J.Get(ToolModels(harness, provider), model))
        if !Unrestricted(harness, provider) && !efforts.Exists(item -> modelOnly || item.GetString() == effort) {
            throw Exception("Model/effort pair is not allowed by the repository policy. No inference started.")
        }

        ValidateBudget(seconds)
    }

    internal func ValidateBudget(seconds int32, unlimited bool = false) {
        if unlimited && !J.Bool(Value, "allow_unlimited") {
            throw Exception("Repository policy does not allow unlimited coding")
        }

        let maximum = J.Number(Value, "max_seconds")
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
            Validate(
                J.Text(tool, "harness"),
                J.Text(tool, "provider"),
                J.Text(tool, "model"),
                J.Text(tool, "effort"),
                1,
                source == "external"
            )
        }
    }

    internal func Providers(harness string) List[string] -> J
        .Items(Tools)
        .Where(tool -> J.Text(tool, "harness") == harness)
        .Select(tool -> J.Text(tool, "provider"))
        .Distinct(StringComparer.Ordinal)
        .ToList()

    internal func AllowsTool(harness string, provider string) bool -> Tool(
        harness,
        provider
    ).ValueKind == JsonValueKind.Object

    shared {
        internal func CloseMessage(value JsonElement) string -> J.Get(value, "close_message")
            .ValueKind == JsonValueKind.Undefined ?
        "This pull request lacks current owner authorization. Please request owner approval.": J.Text(
            value,
            "close_message"
        )

        internal func Load(repo string, revision string) Policy -> Policy(
            GitHub.FileAt(repo, ".github/tokate.json", revision)
        )
    }
}
