package TokateDesktop

import Goo
import System
import System.Diagnostics
import System.IO

open class TestHost : EmbeddedWindowHost {
    var Clipboard string = ""
    protected override func RequestFrame() { }

    protected override func LoadVulkanLibrary() bool -> false

    protected override func GetVulkanGetInstanceProcAddr() nint -> nint(0)

    protected override func UnloadVulkanLibrary() { }

    protected override func GetVulkanInstanceExtensions()[]string -> []string{}

    protected override func CreateVulkanSurface(instance nint, out surface uint64) bool {
        surface = 0
        return false
    }

    protected override func DestroyVulkanSurface(instance nint, surface uint64) { }

    protected override func GetClipboardText() string -> Clipboard

    protected override func SetClipboardText(value string) {
        Clipboard = value
    }
}

class TestAccessibility : AccessibilityAdapter {
    var Root AccessibilityNode?
    func Update(tree AccessibilityTree) {
        Root = tree.Root
    }
}

func Require(value bool, message string) {
    if !value {
        throw InvalidOperationException(message)
    }
}

func Find(node AccessibilityNode?, role AccessibilityRole, name string = "") AccessibilityNode? {
    guard let item = node else {
        return nil
    }
    if item.Role == role && (name == "" || item.Name == name || item.Value == name) {
        return item
    }
    for child in item.Children {
        if let found = Find(child, role, name) {
            return found
        }
    }
    return nil
}

func Settle(host TestHost) {
    for i in 0 ... 7 {
        host.RenderFrame(0.016)
    }
}

func FindText(node AccessibilityNode?, text string) bool {
    guard let item = node else {
        return false
    }
    if item.Role == AccessibilityRole.Text && (item.Name.Contains(text) || item.Value.Contains(text)) {
        return true
    }
    for child in item.Children {
        if FindText(child, text) {
            return true
        }
    }
    return false
}

func Press(window Window, key Key, ctrl bool = false) {
    window.PlatformInput.KeyPress(key, KeyModifiers{Ctrl: ctrl})
    window.PlatformInput.KeyRelease(key, KeyModifiers{Ctrl: ctrl})
}

func Activate(
    window Window,
    adapter TestAccessibility,
    name string,
    role AccessibilityRole = AccessibilityRole.Button
) {
    let node = Find(adapter.Root, role, name) ?? throw Exception("Missing control: " + name)
    Require(
        window.PerformAccessibilityAction(node.Id, AccessibilityActionRequest(AccessibilityAction.Activate)),
        "Cannot activate " + name
    )
}

func AwaitControl(
    host TestHost,
    adapter TestAccessibility,
    role AccessibilityRole,
    name string,
    value string = "",
    enabled bool = false
) {
    let clock = Stopwatch.StartNew()
    while clock.Elapsed.TotalSeconds < 10 {
        Settle(host)
        if let node = Find(adapter.Root, role, name) {
            if (value == "" || node.Value == value) && (!enabled || !node.Disabled) {
                return
            }
        }
    }
    throw Exception("Timed out waiting for " + name + " / " + value)
}

func ScrollOutput(host TestHost, window Window, adapter TestAccessibility, end bool) {
    let view = Find(adapter.Root, AccessibilityRole.Generic, "Donation output") ?? throw Exception("Missing output")
    Require(
        window.PerformAccessibilityAction(view.Id, AccessibilityActionRequest(AccessibilityAction.Focus)),
        "Cannot focus activity"
    )
    Press(window, end ? Key.End: Key.Home)
    Settle(host)
}

func Script(directory string, name string, body string) {
    let path = Path.Combine(directory, name)
    let gate = name != "tokate" ? "": "gated=false\ncase \"$$1\" in approve|revoke|claim|pause|resume|renew|release|amend|external|checks) gated=true;; access) case \"$$2\" in init|trust|untrust|deny|restore|request) gated=true;; esac;; work) [ \"$$2\" = --run ] && gated=true;; esac\nif [ \"$$gated\" = true ]; then\n yes=false\n for arg in \"$$@\"; do [ \"$$arg\" = --yes ] && yes=true; done\n if [ \"$$yes\" = false ]; then printf '{\"schema_version\":1,\"command\":\"%s\",\"status\":\"error\",\"exit_code\":1,\"data\":{\"applied\":false},\"error\":{\"code\":\"confirmation_required\",\"message\":\"Confirm this action\"},\"next_actions\":[],\"truncated\":false}' \"$$1\"; exit 1; fi\nfi\n"
    let submitGate = name == "tokate" && !body.Contains("pull_request") ? "if [ \"$$1\" = submit ]; then\n yes=false\n for arg in \"$$@\"; do [ \"$$arg\" = --yes ] && yes=true; done\n if [ \"$$yes\" = false ]; then printf '{\"schema_version\":1,\"command\":\"submit\",\"status\":\"error\",\"exit_code\":1,\"data\":{\"applied\":false},\"error\":{\"code\":\"confirmation_required\",\"message\":\"Confirm publication\"},\"next_actions\":[],\"truncated\":false}'; exit 1; fi\nfi\n": ""
    File.WriteAllText(path, "#!/bin/sh\n" + gate + submitGate + body)
    File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute)
}

func DonateFlow(host TestHost, window Window, adapter TestAccessibility, donation DonationService) {
    let fixture = Path.Combine(Path.GetTempPath(), "tokate-gui-flow-" + Guid.NewGuid().ToString("N"))
    let previous = Environment.GetEnvironmentVariable("PATH")
    Directory.CreateDirectory(fixture, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute)
    try {
        Script(
            fixture,
            "gh",
            "if [ \"$2\" = user ]; then for i in $$(seq 1 200); do [ -e '" +
                fixture +
                "/release-lookup' ] && break; sleep .05; done; printf '%s' '{\"login\":\"fixture\"}'; else printf '%s' '{\"number\":278,\"title\":\"Improve the desktop\",\"state\":\"open\",\"labels\":[{\"name\":\"tokate:approved\"}]}'; fi\n"
        )
        Script(
            fixture,
            "tokate",
            "case \"$1\" in\ndoctor) data='{\"policy\":{\"version\":3,\"allow_unlimited\":true,\"max_seconds\":3600,\"allowed_tools\":[{\"harness\":\"codex\",\"provider\":\"openai\"},{\"harness\":\"pi\",\"provider\":\"local-chat-completions\"}]}}';;\ndefaults) if [ \"$2\" = check ]; then data='{\"harness\":\"codex\",\"provider\":\"openai\",\"model\":\"gpt-6.1-sol\",\"effort\":\"high\"}'; else data='{\"profiles\":{},\"default\":{\"harness\":\"codex\",\"model\":\"obsolete-default\",\"effort\":\"low\"}}'; fi;;\n*) exit 1;;\nesac\nprintf '{\"schema_version\":1,\"command\":\"%s\",\"status\":\"ok\",\"exit_code\":0,\"data\":%s}' \"$1\" \"$$data\"\n"
        )
        Directory.CreateDirectory(Path.Combine(fixture, "run"))
        let request = Guid.NewGuid().ToString("D")
        File.WriteAllText(
            Path.Combine(fixture, "run", "run.json"),
            "{\"claim_request\":{\"uuid\":\"" + request + "\"}}"
        )
        let commandPath = Path.Combine(fixture, "tokate")
        let claim = "claim) printf '%s\\n' \"$$@\" > '" +
            fixture +
            "/claim-args'; printf 'Waiting for coordinator\\n' >&2; for i in $$(seq 1 200); do [ -e '" +
            fixture +
            "/release-claim' ] && break; sleep .05; done; data='{\"run\":\"" +
            fixture +
            "/run\"}';;\n"
        let status = "status) if [ \"$$2\" = --run ]; then data='{\"run\":\"" +
            fixture +
            "/run\",\"state\":\"claim_pending\",\"approval\":\"approval-fixture\",\"donor_id\":7,\"repo\":\"owner/repo\",\"issue\":278,\"model\":\"gpt-6.1-sol\",\"effort\":\"high\",\"seconds\":1800,\"verification_reserve\":1800,\"unlimited\":true,\"coding_seconds\":null}'; else touch '" +
            fixture +
            "/approval-checked'; claim=unrelated; [ -e '" +
            fixture +
            "/approve' ] && claim='" +
            request +
            "'; data='{\"coordination\":{\"approval_id\":\"approval-fixture\",\"revoked\":false,\"reservation\":{\"lease\":\"'\"$$claim\"'\",\"attempt\":\"'\"$$claim\"'\",\"actor\":7,\"status\":\"active\",\"expires\":4102444800}}}'; fi;;\n"
        let work = "work) touch '" +
            fixture +
            "/work-started'; trap 'touch \"" +
            fixture +
            "/cancelled\"; exit 0' INT; printf 'Preparing checkout\\n' >&2; for j in $$(seq 1 50); do printf 'Output line %s\\n' \"$$j\" >&2; done; for i in $$(seq 1 200); do sleep .05; done;;\n"
        var script = File.ReadAllText(commandPath).Replace(
            "*) exit 1;;",
            claim + status + work + "*) exit 1;;"
        )
        script = script.Replace("\"data\":%s}", "\"data\":%s,\"next_actions\":[[\"tokate\",\"work\",\"owner/repo#278-1\",\"--json\"]]}")
        File.WriteAllText(commandPath, script)
        Script(
            fixture,
            "codex",
            "[ \"$$HOME\" = \"$$CODEX_HOME\" ] && [ \"$$PWD\" = \"$$HOME\" ] && [ \"$1 $2 $3\" = 'debug models --bundled' ] || exit 1\nprintf '%s' '{\"models\":[{\"slug\":\"gpt-6.1-sol\",\"display_name\":\"GPT-6.1-Sol\",\"supported_reasoning_levels\":[{\"effort\":\"high\"},{\"effort\":\"ultra\"}]},{\"slug\":\"gpt-6-luna\",\"display_name\":\"GPT-6-Luna\",\"supported_reasoning_levels\":[{\"effort\":\"high\"},{\"effort\":\"max\"}]}]}'\n"
        )
        Environment.SetEnvironmentVariable("PATH", fixture + ":" + previous)
        let githubPath = Path.Combine(fixture, "gh")
        let github = File.ReadAllText(githubPath)
        File.WriteAllText(githubPath, github.Replace("{\"name\":\"tokate:approved\"}", ""))
        Require(window.PlatformInput.CommitText("https://github.com/owner/repo/issues/278"), "Cannot enter issue URL")
        Settle(host)
        AwaitControl(host, adapter, AccessibilityRole.Button, "Choose repository", enabled: true)
        guard let lookup = Find(adapter.Root, AccessibilityRole.Button, "Choose repository") else {
            throw Exception("Missing lookup button")
        }
        guard let heading = Find(adapter.Root, AccessibilityRole.Text, "Choose a repository") else {
            throw Exception("Missing issue heading")
        }
        let lookupBounds = lookup.Bounds
        let headingBounds = heading.Bounds
        Activate(window, adapter, "Choose repository")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Cancel command")
        Require(
            Find(adapter.Root, AccessibilityRole.Button, "Cancel command")?.Bounds == lookupBounds,
            "Loading changed the action button bounds"
        )
        Require(
            Find(adapter.Root, AccessibilityRole.Text, "Choose a repository")?.Bounds == headingBounds,
            "Loading shifted the page"
        )
        Require(
            Find(adapter.Root, AccessibilityRole.Text, "Command output") == nil &&
                Find(adapter.Root, AccessibilityRole.Generic, "Donation output") == nil,
            "Loading displayed a donation output panel"
        )
        File.WriteAllText(Path.Combine(fixture, "release-lookup"), "release")
        AwaitControl(host, adapter, AccessibilityRole.Text, "Issue #278 needs owner approval.")
        Require(
            Find(adapter.Root, AccessibilityRole.ComboBox, "Model") == nil,
            "Unapproved issue reached model selection"
        )
        File.WriteAllText(githubPath, github)
        Activate(window, adapter, "Choose repository")
        AwaitControl(host, adapter, AccessibilityRole.ComboBox, "Model", "GPT-6.1-Sol")
        Require(Find(adapter.Root, AccessibilityRole.Text, "Set your limits") != nil, "Step II heading missing")
        Require(Find(adapter.Root, AccessibilityRole.Text, "II") != nil, "Step II numeral missing")
        Require(
            Find(adapter.Root, AccessibilityRole.ComboBox, "Reasoning effort")?.Value == "High",
            "Default effort is not High"
        )
        for width in[]int32{800, 1024, 1280, 1920, 800} {
            host.Resize(width, 600, width, 600)
            Settle(host)
            for name in[]string{"Model", "Reasoning effort", "More per task", "More verification share"} {
                var found = Find(adapter.Root, AccessibilityRole.ComboBox, name)
                found ??= Find(adapter.Root, AccessibilityRole.Button, name)
                guard let control = found else {
                    throw Exception("Missing donation control: " + name)
                }
                Require(
                    control.Bounds.X >= (width < 900 ? 0: 202) && control.Bounds.X + control.Bounds.Width <= width + 1,
                    "Donation control escaped the window: " + name
                )
            }
        }
        host.Resize(1440, 900, 1440, 900)
        Settle(host)
        guard let tools = Find(adapter.Root, AccessibilityRole.Group, "Model settings") else {
            throw Exception("Missing tool card")
        }
        guard let limits = Find(adapter.Root, AccessibilityRole.Group, "Time limit settings") else {
            throw Exception("Missing limit card")
        }
        Require(Math.Abs(tools.Bounds.Height - limits.Bounds.Height) < 1, "Donation cards have different heights")
        Require(
            Find(adapter.Root, AccessibilityRole.Button, "Back")?.Bounds.Y >= tools.Bounds.Y + tools.Bounds.Height,
            "Navigation is inside a settings card"
        )
        donation.SetCoding("60")
        Settle(host)
        Require(Find(adapter.Root, AccessibilityRole.Button, "More per task")?.Disabled == true, "Stepper exceeds the owner time limit")
        donation.SetCoding("15")
        Settle(host)
        Activate(window, adapter, "More per task")
        Settle(host)
        Require(donation.Current.Draft.BudgetSeconds(donation.Current.Policy) == 1200, "Time stepper was not applied")
        donation.SetCoding("30")
        Settle(host)
        Activate(window, adapter, "Model", AccessibilityRole.ComboBox)
        Settle(host)
        Press(window, Key.End)
        Press(window, Key.Enter)
        Settle(host)
        Require(
            Find(adapter.Root, AccessibilityRole.ComboBox, "Model")?.Value == "GPT-6-Luna",
            "Model dropdown did not commit"
        )
        Activate(window, adapter, "Reasoning effort", AccessibilityRole.ComboBox)
        Settle(host)
        Require(
            Find(adapter.Root, AccessibilityRole.ListItem, "Ultra") == nil,
            "Unsupported effort leaked between models"
        )
        Press(window, Key.End)
        Press(window, Key.Enter)
        Settle(host)
        Require(
            Find(adapter.Root, AccessibilityRole.ComboBox, "Reasoning effort")?.Value == "Max",
            "Effort dropdown did not commit"
        )
        Activate(window, adapter, "OMP")
        Settle(host)
        Require(
            Find(adapter.Root, AccessibilityRole.ComboBox, "Model") == nil &&
                Find(adapter.Root, AccessibilityRole.TextInput, "Model") != nil,
            "Local model is not editable"
        )
        Activate(window, adapter, "Codex")
        Settle(host)
        Require(
            Find(adapter.Root, AccessibilityRole.ComboBox, "Model")?.Value == "GPT-6.1-Sol",
            "Codex did not restore Sol"
        )
        Activate(window, adapter, "Review donation")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Change details")
        Require(Find(adapter.Root, AccessibilityRole.Text, "III") != nil, "Step III numeral missing")
        Require(
            Find(adapter.Root, AccessibilityRole.Text, "Command completed.") == nil,
            "Routine completion text remains"
        )
        Activate(window, adapter, "Change details")
        Settle(host)
        Activate(window, adapter, "Unlimited coding", AccessibilityRole.Checkbox)
        Settle(host)
        Require(Find(adapter.Root, AccessibilityRole.Button, "More per task")?.Disabled == true, "Unlimited still requests a bounded per-task time")
        Require(Find(adapter.Root, AccessibilityRole.Button, "More verification share") != nil, "Unlimited lost its verification limit")
        Activate(window, adapter, "Review donation")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Reserve contribution")
        Activate(window, adapter, "Reserve contribution")
        Settle(host)
        Activate(window, adapter, "Send request")
        AwaitControl(host, adapter, AccessibilityRole.Text, "Reserving donation")
        Require(
            Find(adapter.Root, AccessibilityRole.Text, "Command output") == nil &&
                Find(adapter.Root, AccessibilityRole.Generic, "Donation output") == nil,
            "Reservation displayed a donation output panel"
        )
        Activate(window, adapter, "Welcome")
        Settle(host)
        Require(
            Find(adapter.Root, AccessibilityRole.Text, "a purpose") != nil,
            "Navigation is blocked during reservation"
        )
        AwaitControl(host, adapter, AccessibilityRole.Button, "Show Reserving donation")
        Activate(window, adapter, "Switch to moonlight")
        Settle(host)
        Require(
            Find(adapter.Root, AccessibilityRole.Button, "Switch to daylight") != nil,
            "Theme control is blocked during reservation"
        )
        let claimed = File.ReadAllText(Path.Combine(fixture, "claim-args"))
        Require(
            claimed.Contains("--yes\n") && claimed.Contains("--unlimited\n") && !claimed.Contains("--time\n") && claimed.Contains(
                "--verify-time\n14m\n"
            ),
            "Unlimited claim arguments do not match the CLI"
        )
        Activate(window, adapter, "Donate")
        Settle(host)
        Require(
            Find(adapter.Root, AccessibilityRole.Button, "Start donation")?.Disabled == true,
            "Start enabled before reservation completed"
        )
        File.WriteAllText(Path.Combine(fixture, "release-claim"), "release")
        AwaitControl(host, adapter, AccessibilityRole.Text, "Waiting for approval")
        Require(
            Find(adapter.Root, AccessibilityRole.Button, "Start donation")?.Disabled == true,
            "Start enabled before approval"
        )
        let observed = Stopwatch.StartNew()
        while !File.Exists(Path.Combine(fixture, "approval-checked")) && observed.Elapsed.TotalSeconds < 8 {
            Settle(host)
        }
        Require(File.Exists(Path.Combine(fixture, "approval-checked")), "Approval was not checked")
        Settle(host)
        Require(
            Find(adapter.Root, AccessibilityRole.Button, "Start donation")?.Disabled == true,
            "An unrelated reservation enabled Start"
        )
        Require(!File.Exists(Path.Combine(fixture, "work-started")), "Inference started without consent")
        File.WriteAllText(Path.Combine(fixture, "approve"), "approved")
        let progress = donation.Current.Progress
        donation.Open(progress.Run, progress.Path)
        AwaitControl(host, adapter, AccessibilityRole.Button, "Start donation", enabled: true)
        Activate(window, adapter, "Start donation")
        Settle(host)
        Require(FindText(adapter.Root, "Unlimited"), "Donation lost the unlimited coding choice")
        Activate(window, adapter, "Start this donation")
        AwaitControl(host, adapter, AccessibilityRole.Status, "Donation running")
        AwaitControl(host, adapter, AccessibilityRole.Text, "Command output")
        window.RequestClose()
        Settle(host)
        Require(window.IsOpen, "Closing the window terminated active work")
        Require(FindText(adapter.Root, "A command is active"), "Blocked close did not explain how to stop safely")
        let transcript = Stopwatch.StartNew()
        while !FindText(adapter.Root, "Output line 50") && transcript.Elapsed.TotalSeconds < 5 {
            Settle(host)
        }
        Require(FindText(adapter.Root, "Output line 50"), "The output panel did not follow new activity")
        ScrollOutput(host, window, adapter, false)
        Require(FindText(adapter.Root, "Preparing checkout"), "The output panel lost earlier activity")
        Activate(window, adapter, "Follow live")
        Settle(host)
        Require(FindText(adapter.Root, "Output line 50"), "Cannot return to the latest activity")
        AwaitControl(host, adapter, AccessibilityRole.Text, "Elapsed 00:01")
        guard let footer = Find(adapter.Root, AccessibilityRole.Text, "Elapsed 00:01") else {
            throw Exception("Missing elapsed footer")
        }
        Require(footer.Bounds.Y + footer.Bounds.Height <= window.Height, "Elapsed footer overflowed the window")
        Activate(window, adapter, "My project")
        Settle(host)
        Require(Find(adapter.Root, AccessibilityRole.Text, "My project") != nil, "Navigation is blocked during work")
        Require(
            Find(adapter.Root, AccessibilityRole.Status, "Donation running") == nil &&
                Find(adapter.Root, AccessibilityRole.Text, "Command output") == nil,
            "Donation output leaked to another view"
        )
        Activate(window, adapter, "Donate")
        AwaitControl(host, adapter, AccessibilityRole.Status, "Donation running")
        ScrollOutput(host, window, adapter, false)
        Require(FindText(adapter.Root, "Preparing checkout"), "Donation output was lost after navigation")
        Activate(window, adapter, "Cancel command")
        let cancelled = Stopwatch.StartNew()
        while cancelled
            .Elapsed
            .TotalSeconds < 10 &&
            Find(adapter.Root, AccessibilityRole.Status, "Donation running") != nil {
            Settle(host)
        }
        Require(
            Find(adapter.Root, AccessibilityRole.Status, "Donation running") == nil,
            "Running state survived cancellation"
        )
        Require(File.Exists(Path.Combine(fixture, "cancelled")), "Cancel did not interrupt the worker gracefully")
        File.WriteAllText(commandPath, File.ReadAllText(commandPath).Replace("claim_pending", "claimed"))
        Activate(window, adapter, "View saved work")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Start donation", enabled: true)
        Activate(window, adapter, "Start donation")
        Settle(host)
        Require(FindText(adapter.Root, "Unlimited"), "Saved work did not confirm its Unlimited budget")
        Activate(window, adapter, "Go back")
        Settle(host)
        Require(Find(adapter.Root, AccessibilityRole.Text, "Donation") != nil, "Saved work did not open Donate")
        RepositoryDonateFlow(host, window, adapter, donation, fixture)
    } finally {
        Environment.SetEnvironmentVariable("PATH", previous)
        Directory.Delete(fixture, true)
    }
}

func RepositoryDonateFlow(host TestHost, window Window, adapter TestAccessibility, donation DonationService, fixture string) {
    let files = Path.Combine(AppContext.BaseDirectory, "Fixtures")
    File.Copy(Path.Combine(files, "donation-gratis-preview.json"), Path.Combine(fixture, "preview.json"))
    File.Copy(Path.Combine(files, "donation-gratis-preview.txt"), Path.Combine(fixture, "consent.txt"))
    let taskRun = Directory.CreateDirectory(Path.Combine(fixture, "task-run")).FullName
    File.WriteAllText(Path.Combine(taskRun, "report.md"), "Task 42 saved report\nVerification passed")
    Script(fixture, "gh", "if [ \"$$2\" = user ]; then printf '%s' '{\"login\":\"fixture\"}'; elif [ \"$$2\" = search/issues ]; then printf '%s' '{\"items\":[{\"number\":42,\"title\":\"First task\",\"state\":\"open\",\"html_url\":\"https://github.com/obselate/goo/issues/42\",\"labels\":[]},{\"number\":44,\"title\":\"Second task\",\"state\":\"open\",\"html_url\":\"https://github.com/obselate/goo/issues/44\",\"labels\":[]}],\"total_count\":2}'; else printf '%s' '{\"full_name\":\"obselate/goo\"}'; fi\n")
    Script(
        fixture, "tokate",
        ("printf '%s\\n' \"$$@\" >> FIXTURE/repository-calls\n" +
        "case \"$$1\" in\n" +
        "defaults) printf '%s' '{\"schema_version\":1,\"command\":\"defaults\",\"status\":\"ok\",\"exit_code\":0,\"data\":{\"profiles\":{}}}';;\n" +
        "doctor) printf '%s' '{\"schema_version\":1,\"command\":\"doctor\",\"status\":\"ok\",\"exit_code\":0,\"data\":{\"policy\":null}}';;\n" +
        "work)\n" +
        "if [ \"$$3\" = stop ]; then touch FIXTURE/stop-requested; while [ -d FIXTURE ] && [ ! -e FIXTURE/task-done ]; do sleep .05; done\n" +
        "else\n" +
        "yes=false; for arg in \"$$@\"; do [ \"$$arg\" = --yes ] && yes=true; done\n" +
        "if [ \"$$yes\" = false ]; then cat FIXTURE/consent.txt >&2; cat FIXTURE/preview.json; exit 1; fi\n" +
        "printf 'Repository task started\\n' >&2; touch FIXTURE/repository-started\n" +
        "while [ ! -e FIXTURE/stop-requested ]; do sleep .05; done\n" +
        "printf 'Finishing current task\\n' >&2\n" +
        "while [ ! -e FIXTURE/release-task ]; do sleep .05; done\n" +
        "touch FIXTURE/task-done\n" +
        "fi\n" +
        "printf '%s' '{\"schema_version\":1,\"command\":\"work\",\"status\":\"ok\",\"exit_code\":0,\"data\":{\"repo\":\"obselate/goo\",\"reason\":\"stopped\",\"submitted\":1,\"skipped\":1,\"failed\":0,\"usage\":{\"input_tokens\":120,\"cached_input_tokens\":20,\"output_tokens\":30},\"wall_seconds\":2.5,\"tasks\":[{\"issue\":42,\"result\":\"submitted\",\"pr_url\":\"https://github.com/obselate/goo/pull/43\",\"run_directory\":\"/fixture/run\"},{\"issue\":44,\"result\":\"skipped\",\"reason\":\"refused\",\"pr_url\":\"\",\"run_directory\":\"\"},{\"issue\":45,\"result\":\"completed\",\"pr_url\":\"\",\"run_directory\":\"/fixture/review\"}]}}';;\n" +
        "*) exit 1;;\nesac\n")
            .Replace("FIXTURE", fixture).Replace("/fixture/run", taskRun)
    )
    donation.NewDonation()
    Settle(host)
    Choose(host, window, adapter, "Repository donation")
    Edit(window, host, adapter, "GitHub repository", "obselate/goo")
    AwaitControl(host, adapter, AccessibilityRole.Button, "Choose repository", enabled: true)
    Choose(host, window, adapter, "Choose repository")
    AwaitControl(host, adapter, AccessibilityRole.Button, "Review donation", enabled: true)
    Require(Find(adapter.Root, AccessibilityRole.Button, "Owner command") == nil, "Gratis offers an owner command without policy argv")
    Require(FindText(adapter.Root, "Until stopped"), "Total did not start until stopped")
    Require(Find(adapter.Root, AccessibilityRole.Button, "Less total")?.Disabled ?? false, "Total minimum is not disabled")
    Require(Find(adapter.Root, AccessibilityRole.Checkbox, "Until stopped") == nil, "Total still uses a checkbox")
    Choose(host, window, adapter, "More total")
    Require(donation.Current.Total == "5", "Total did not advance to its lowest duration")
    Require(Find(adapter.Root, AccessibilityRole.Button, "More total")?.Bounds.X == Find(adapter.Root, AccessibilityRole.Button, "More per task")?.Bounds.X, "Time steppers use different columns")
    Choose(host, window, adapter, "Less total")
    Require(donation.Current.Total == "" && FindText(adapter.Root, "Until stopped"), "Total did not return to until stopped")
    donation.SetPerTask("15")
    donation.SetTotal("30")
    Choose(host, window, adapter, "Choose issues")
    AwaitControl(host, adapter, AccessibilityRole.Checkbox, "#42  First task")
    Activate(window, adapter, "#42  First task", AccessibilityRole.Checkbox)
    Settle(host)
    Activate(window, adapter, "#44  Second task", AccessibilityRole.Checkbox)
    Settle(host)
    Require(donation.Current.IssueList == "42,44", "Issue checkboxes did not preserve run order")
    donation.SetReviewEach(true)
    Settle(host)
    Choose(host, window, adapter, "Review donation")
    AwaitControl(host, adapter, AccessibilityRole.Button, "Start donating", enabled: true)
    Require(FindText(adapter.Root, "Gratis"), "Repository review omitted gratis mode")
    Require(FindText(adapter.Root, "docs/native-authoring.md"), "Repository review omitted guidance files")
    Require(!FindText(adapter.Root, "Preview only; use --yes"), "Raw CLI instructions leaked into structured consent")
    Require(!File.Exists(Path.Combine(fixture, "repository-started")), "Preview started work")
    Choose(host, window, adapter, "Start donating")
    Require(!File.Exists(Path.Combine(fixture, "repository-started")), "Work started without confirmation")
    Choose(host, window, adapter, "Go back")
    Choose(host, window, adapter, "Start donating")
    Choose(host, window, adapter, "Confirm donation")
    AwaitControl(host, adapter, AccessibilityRole.Button, "Stop after current task", enabled: true)
    let started = Stopwatch.StartNew()
    while !FindText(adapter.Root, "Repository task started") && started.Elapsed.TotalSeconds < 5 {
        Settle(host)
    }
    Require(FindText(adapter.Root, "Repository task started"), "Repository stderr did not stream")
    Choose(host, window, adapter, "Stop after current task")
    Require(!File.Exists(Path.Combine(fixture, "stop-requested")), "Stop ran before confirmation")
    Choose(host, window, adapter, "Stop after current task")
    AwaitControl(host, adapter, AccessibilityRole.Button, "Stopping after current task")
    let stopping = Stopwatch.StartNew()
    while !FindText(adapter.Root, "Finishing current task") && stopping.Elapsed.TotalSeconds < 5 {
        Settle(host)
    }
    Require(donation.Current.Progress.Running, "Stop killed the loop before the task finished")
    Require(FindText(adapter.Root, "Finishing current task"), "Progress stopped while waiting for task completion")
    File.WriteAllText(Path.Combine(fixture, "release-task"), "")
    AwaitControl(host, adapter, AccessibilityRole.Button, "New donation", enabled: true)
    Require(FindText(adapter.Root, "Stopped by you") && FindText(adapter.Root, "Submitted"), "Session counts or stop reason missing")
    Require(FindText(adapter.Root, "2.5 s") && FindText(adapter.Root, "150"), "Session token total or wall time missing")
    Require(FindText(adapter.Root, "#44") && FindText(adapter.Root, "skipped") && FindText(adapter.Root, "refused"), "Task results missing")
    Require(Find(adapter.Root, AccessibilityRole.Button, "Open pull request 42") != nil, "Session PR link missing")
    let calls = File.ReadAllText(Path.Combine(fixture, "repository-calls"))
    Require(calls.Contains("stop\n--yes\n--json"), "Repository stop argv is incorrect")
    Require(calls.Contains("obselate/goo#42,44") && calls.Contains("--review"), "Gratis selection and review argv missing")
    Require(donation.Current.Session.Tasks.Length == 3, "Final session report was not decoded")
    Require(FindText(adapter.Root, "Ready to submit") && Find(adapter.Root, AccessibilityRole.Button, "Open saved run 45") != nil, "Review task has no saved-run action")
    Choose(host, window, adapter, "Expand Task output")
    Require(FindText(adapter.Root, "Task 42 saved report") && FindText(adapter.Root, "Verification passed"), "Task output did not read its saved run report")
    Choose(host, window, adapter, "Collapse Task output")
    Require(!FindText(adapter.Root, "Task 42 saved report"), "Collapsed task output is still shown")
}

func SubmitFlow(host TestHost, desktop DesktopApp) {
    let fixture = Path.Combine(Path.GetTempPath(), "tokate-submit-" + Guid.NewGuid().ToString("N"))
    let previous = Environment.GetEnvironmentVariable("PATH")
    Directory.CreateDirectory(fixture)
    try {
        Script(fixture, "gh", "printf '{}'\n")
        Script(
            fixture,
            "tokate",
            "cd '" + fixture + "'\n" +
                "if [ \"$1\" = submit ] && [ \"$4\" != --yes ]; then printf '%s' '{\"schema_version\":1,\"command\":\"submit\",\"status\":\"ok\",\"exit_code\":0,\"data\":{\"applied\":false,\"pull_request\":{\"title\":\"Ready for review\",\"body\":\"Summary\",\"base\":\"main\",\"head\":\"work\"}},\"next_actions\":[]}'; exit 0; fi\n" +
                "if [ \"$1\" = submit ]; then printf '%s\\n' \"$4\" >> consent; fi\n" +
                "n=0; [ ! -f calls ] || n=$$(cat calls)\n" +
                "if [ \"$1\" = submit ]; then n=$$((n+1)); echo $$n > calls; fi\n" +
                "state=generated; pr=0; code=0; status=ok; error=null\n" +
                "if [ \"$1\" = submit ]; then\n" +
                "if [ $$n -lt 3 ]; then code=8; status=pending\n" +
                "elif [ -f fail ]; then code=1; status=error; error='{\"code\":\"command_failed\",\"message\":\"Owner must update the coordinator and re-process the request.\"}'\n" +
                "fi\nfi\n" +
                "if [ $$n -ge 3 ] && [ ! -f fail ]; then state=published; pr=42; fi\n" +
                "printf '{\"schema_version\":1,\"command\":\"%s\",\"status\":\"%s\",\"exit_code\":%s,\"data\":{\"run\":\"%s\",\"repo\":\"owner/repo\",\"issue\":7,\"state\":\"%s\",\"pr\":%s,\"commit\":\"head\"},\"error\":%s,\"next_actions\":[]}' \"$1\" \"$$status\" \"$$code\" \"$3\" \"$$state\" \"$$pr\" \"$$error\"\n" +
                "exit $$code\n"
        )
        Environment.SetEnvironmentVariable("PATH", fixture + Path.PathSeparator.ToString() + previous)
        desktop.Navigation.Go(Destination.Saved)
        for fail in []bool{false, true} {
            File.WriteAllText(Path.Combine(fixture, "calls"), fail ? "1": "0")
            if fail {
                File.WriteAllText(Path.Combine(fixture, "fail"), "")
            }
            let path = Path.Combine(fixture, fail ? "failed": "done")
            Directory.CreateDirectory(path)
            desktop.Saved.Select(SavedRun.Pending(path) with{Run = Run.Empty with{Path = path, Repo = "owner/repo", Issue = 7, State = "generated", Commit = "head", Gratis = true}, Refreshed = true})
            desktop.Saved.Act(RunAction.Submit)
            let preview = Stopwatch.StartNew()
            while desktop.Saved.Current.Review == nil && preview.Elapsed.TotalSeconds < 5 {
                Settle(host)
            }
            Require(desktop.Saved.Current.Review != nil && !desktop.Saved.Current.Waiting, "Submit preview reported publication")
            desktop.Saved.PublishSubmit()
            desktop.Dialogs.Confirm()
            let clock = Stopwatch.StartNew()
            var pending = false
            while clock.Elapsed.TotalSeconds < 140 {
                Settle(host)
                pending = pending || desktop.Saved.Current.Waiting
                if !desktop.Activity.Busy && !desktop.Saved.Current.Waiting && File.ReadAllText(Path.Combine(fixture, "calls")).Trim() == "3" {
                    break
                }
                System.Threading.Thread.Sleep(10)
            }
            Require(pending && clock.Elapsed.TotalSeconds < 140, "Submit exit 8 did not keep polling and repeat submit")
            Require(Array.TrueForAll(File.ReadAllLines(Path.Combine(fixture, "consent")), value -> value == "--yes"), "Pending submit lost publication consent")
            if fail {
                Require(desktop.Feedback.Current.Message.Contains("Owner must update the coordinator"), "Submit failure hid owner guidance")
            } else {
                Require(desktop.Saved.Current.Run.Pr == 42 && !desktop.Saved.Current.Waiting, "Submit exit 0 did not finish with its PR")
            }
        }
    } finally {
        Environment.SetEnvironmentVariable("PATH", previous)
        Directory.Delete(fixture, true)
    }
}

func TestDesktop() {
    using let body = FontSource("Newsreader", 400, false, File.ReadAllBytes(Asset("newsreader.ttf")))
    using let heading = FontSource("Cormorant", 500, false, File.ReadAllBytes(Asset("cormorant.ttf")))
    body.Register()
    heading.Register()
    using let art = ArtworkService()
    using let host = TestHost()
    let adapter = TestAccessibility()
    let desktop = DesktopApp.Create(art)
    let window = Window{Root: desktop.Root, AccessibilityAdapter: adapter}
    desktop.Attach(window)
    host.Resize(1280, 860, 1280, 860)
    window.Attach(host)
    host.SetFocused(true)
    Settle(host)
    for width in[]int32{800, 1024, 1280, 1920, 800} {
        host.Resize(width, 600, width, 600)
        Settle(host)
        let title = Find(adapter.Root, AccessibilityRole.Text, "a purpose") ?? throw Exception("Missing headline")
        for name in[]string{"Donate AI time", "Open your project", "Pick up your work"} {
            let action = Find(adapter.Root, AccessibilityRole.Button, name) ?? throw Exception("Missing home action")
            Require(
                action.Bounds.X >= (width < 900 ? 0: 202) && action.Bounds.X + action.Bounds.Width <= width + 1,
                "Home action escaped the content width"
            )
            Require(action.Bounds.Y >= title.Bounds.Y + title.Bounds.Height, "Home action overlaps the headline")
            Require(action.Bounds.Y + action.Bounds.Height <= 600, "Home action overflows the window height")
        }
        Require(
            Find(adapter.Root, AccessibilityRole.Button, "Make a contribution") == nil,
            "Duplicate contribution action"
        )
    }
    host.Resize(1280, 860, 1920, 1290)
    Settle(host)
    let donate = Find(adapter.Root, AccessibilityRole.Button, "Donate") ?? throw Exception("Missing navigation")
    let navigationX = float32(donate.Bounds.X + donate.Bounds.Width / 2)
    let navigationY = float32(donate.Bounds.Y + donate.Bounds.Height / 2)
    window.PlatformInput.PointerPress(
        1,
        PointerDevice.Mouse,
        navigationX,
        navigationY,
        PointerButton.Primary,
        KeyModifiers{},
        1
    )
    window.PlatformInput.PointerRelease(
        1,
        PointerDevice.Mouse,
        navigationX,
        navigationY,
        PointerButton.Primary,
        KeyModifiers{},
        0
    )
    Settle(host)
    let field = Find(adapter.Root, AccessibilityRole.TextInput) ?? throw Exception("Missing repository input")
    let x = float32(field.Bounds.X + field.Bounds.Width / 2)
    let y = float32(field.Bounds.Y + field.Bounds.Height / 2)
    window.PlatformInput.PointerPress(1, PointerDevice.Mouse, x, y, PointerButton.Primary, KeyModifiers{}, 1)
    window.PlatformInput.PointerRelease(1, PointerDevice.Mouse, x, y, PointerButton.Primary, KeyModifiers{}, 0)
    Settle(host)
    Require(window.PlatformInput.CommitText("owner/repoz"), "Cannot enter repository")
    Press(window, Key.Backspace)
    Require(window.PlatformInput.Editor?.Text == "owner/repo", "Backspace did not remove the last character")
    Press(window, Key.Left)
    Press(window, Key.Delete)
    Require(window.PlatformInput.Editor?.Text == "owner/rep", "Delete or cursor movement failed")
    Press(window, Key.A, true)
    host.Clipboard = "other/project"
    Press(window, Key.V, true)
    Require(window.PlatformInput.Editor?.Text == "other/project", "Select-all and paste failed")
    Press(window, Key.A, true)
    Press(window, Key.Backspace)
    Require(window.PlatformInput.Editor?.Text == "", "Backspace did not remove selected text")
    Settle(host)
    Require(Find(adapter.Root, AccessibilityRole.TextInput)?.Value == "", "The empty input was not retained")
    DonateFlow(host, window, adapter, desktop.Donation)
    SubmitFlow(host, desktop)
}

func AwaitChildStopped(pid int32) {
    let clock = Stopwatch.StartNew()
    using let pulse = tick(TimeSpan.FromMilliseconds(10))
    while clock.Elapsed.TotalSeconds < 2 {
        try {
            let stat = File.ReadAllText("/proc/" + pid.ToString() + "/stat")
            let state = stat[stat.LastIndexOf(')') + 2]
            if state == 'Z' || state == 'X' {
                return
            }
        } catch (error FileNotFoundException) {
            return
        } catch (error DirectoryNotFoundException) {
            return
        }
        select {
            case <- pulse { }
        }
    }
    throw InvalidOperationException("Cancellation left a child process running")
}

func TestCommandLifecycle() {
    let marker = Path.Combine(Path.GetTempPath(), "tokate-child-" + Guid.NewGuid().ToString("N"))
    var child = 0
    try {
        let clock = Stopwatch.StartNew()
        let result = RunTool(
            "/bin/sh",
            []string{
                "-c",
                "sleep 30 </dev/null >/dev/null 2>&1 & printf '%s' \"$$!\" > \"$1\"; trap 'exit 0' INT; while :; do sleep .05; done",
                "fixture",
                marker,
            },
            1
        )
        Require(result.Error.Contains("timed out"), "Lifecycle probe did not time out")
        child = int32.Parse(File.ReadAllText(marker))
        AwaitChildStopped(child)
        Require(clock.Elapsed.TotalSeconds < 8, "Cancellation did not finish promptly")
    } finally {
        if child > 0 {
            try {
                using let process = Process.GetProcessById(child)
                if !process.HasExited {
                    process.Kill(true)
                }
            } catch (error ArgumentException) { }
        }
        File.Delete(marker)
    }
}

/// Runs `tool` directly through a fresh process runner.
func RunTool(tool string, arguments []string, seconds int32 = 120) ProcessResult -> ProcessRunner().Run(
    CommandStart(tool, arguments),
    seconds
)

func RunShutdownJob(marker string, ignore bool, finished Chan[ProcessResult]) {
    let trap = ignore ? "trap '' INT": "trap 'exit 0' INT"
    finished <- RunTool(
        "/bin/sh",
        []string{
            "-c",
            trap + "; sleep 30 </dev/null >/dev/null 2>&1 & printf '%s' \"$$!\" > \"$1\"; while :; do sleep .05; done",
            "fixture",
            marker
        },
        0
    )
}

func TestDesktopShutdown() {
    let root = Path.Combine(Path.GetTempPath(), "tokate-shutdown-" + Guid.NewGuid().ToString("N"))
    Directory.CreateDirectory(root)
    let finished = Chan[ProcessResult](2)
    try {
        for index in 0 ... 2 {
            go RunShutdownJob(Path.Combine(root, index.ToString()), index == 1, finished)
        }
        let startup = Stopwatch.StartNew()
        using let pulse = tick(TimeSpan.FromMilliseconds(10))
        while !File.Exists(Path.Combine(root, "0")) || !File.Exists(Path.Combine(root, "1")) {
            Require(startup.Elapsed.TotalSeconds < 5, "Shutdown jobs did not start")
            select {
                case <- pulse { }
            }
        }
        let shutdown = Stopwatch.StartNew()
        ProcessRunner.Shutdown()
        for index in 0 ... 2 {
            let result = <-finished
            Require(result.Error.Contains("cancelled"), "Shutdown did not cancel its command")
            let child = int32.Parse(File.ReadAllText(Path.Combine(root, index.ToString())))
            AwaitChildStopped(child)
        }
        Require(shutdown.Elapsed.TotalSeconds < 8, "Shutdown exceeded its cleanup deadline")
        let rejected = RunTool("/bin/sh", []string{"-c", "touch \"$1\"; printf '{}'", "fixture", Path.Combine(root, "late")})
        Require(
            rejected.Error.Contains("closing") && !File.Exists(Path.Combine(root, "late")),
            "Shutdown admitted a new command"
        )
    } finally {
        ProcessRunner.Shutdown()
        Directory.Delete(root, true)
    }
}

func Main(args[]string) {
    if Array.IndexOf(args, "--shutdown") >= 0 {
        TestDesktopShutdown()
        Console.WriteLine("PASS: desktop shutdown stops commands and descendants")
        return
    }
    if Array.IndexOf(args, "--lifecycle") >= 0 {
        TestCommandLifecycle()
        Console.WriteLine("PASS: command descendants and timeout cleanup")
        return
    }
    let state = Path.Combine(Path.GetTempPath(), "tokate-gui-state-" + Guid.NewGuid().ToString("N"))
    Environment.SetEnvironmentVariable("XDG_STATE_HOME", state)
    TestDesktop()
    Require(ThemeStore.Read().Night, "The theme choice was not saved")
    Directory.Delete(state, true)
    WorkspaceFlow()
    TestCommandLifecycle()
    let literal = RunTool("/usr/bin/printf", []string{"%s", "{\"value\":\"$(literal); *\"}"})
    Require(
        literal.Error == "" && Json.Text(Json.Parse(literal.Output), "value") == "$(literal); *",
        "Command arguments were not literal"
    )
    let unlimitedResult = RunTool("/bin/sh", []string{"-c", "sleep .2; printf '{}'"}, 0)
    Require(unlimitedResult.Error == "" && unlimitedResult.ExitCode == 0, "Unlimited command expired")
    let large = RunTool("/usr/bin/head", []string{"-c", "1048577", "/dev/zero"})
    Require(large.Error.Contains("display limit"), "Oversized command output was not rejected")
    let noisyRunner = ProcessRunner()
    let noisy = noisyRunner.Run(
        CommandStart("/bin/sh", []string{"-c", "head -c 1048577 /dev/zero >&2; printf finished >&2; printf '{}'"})
    )
    Require(
        noisy.Error == "" && noisy.ExitCode == 0 && noisyRunner.RecentOutput().EndsWith("finished"),
        "Long-running diagnostic output was lost or failed the command"
    )
    let marker = Path.Combine(Path.GetTempPath(), "tokate-gui-cancel-" + Guid.NewGuid().ToString("N"))
    try {
        let interrupted = RunTool(
            "/bin/sh",
            []string{
                "-c",
                "trap 'printf interrupted > \"$1\"; exit 0' INT; while :; do sleep 0.05; done",
                "fixture",
                marker
            },
            1
        )
        Require(
            interrupted.Error.Contains("timed out") && File.Exists(marker),
            "Timeout did not allow graceful interruption"
        )
    } finally {
        File.Delete(marker)
    }
    TestDesktopShutdown()
    Console.WriteLine(
        "PASS: responsive layout, donation controls, saved contribution states, owner setup preservation, confirmation boundaries and cancellation"
    )
}
