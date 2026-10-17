package TokateDesktop

import Goo
import System
import System.Collections.Generic
import System.IO
import System.Text.Json

func Edit(window Window, host TestHost, adapter TestAccessibility, name string, value string) {
    let field = Find(adapter.Root, AccessibilityRole.TextInput, name) ?? throw Exception("Missing field: " + name)
    Require(
        window.PerformAccessibilityAction(field.Id, AccessibilityActionRequest(AccessibilityAction.Focus)),
        "Cannot focus " + name
    )
    Press(window, Key.A, true)
    window.PlatformInput.CommitText(value)
    Settle(host)
}

func Choose(host TestHost, window Window, adapter TestAccessibility, name string) {
    Activate(window, adapter, name)
    Settle(host)
}

func IssueRowCount(node AccessibilityNode?) int32 {
    guard let item = node else {
        return 0
    }
    var count = item.Role == AccessibilityRole.Button && item.Name.StartsWith("Issue #") ? 1: 0
    for child in item.Children {
        count += IssueRowCount(child)
    }
    return count
}

func FocusVisible(
    host TestHost,
    window Window,
    adapter TestAccessibility,
    name string,
    width int32,
    height int32,
    pinned bool = false
) {
    for attempt in 0 ... 128 {
        let control = Find(adapter.Root, AccessibilityRole.Button, name) ?? throw Exception("Missing control: " + name)
        if control.Focused {
            break
        }
        Press(window, Key.Tab)
        Settle(host)
    }
    let focused = Find(adapter.Root, AccessibilityRole.Button, name) ?? throw Exception("Lost control: " + name)
    Require(focused.Focused, "Keyboard cannot reach " + name)
    let bounds = focused.Bounds
    Require(bounds.X >= 0 && bounds.X + bounds.Width <= width + 1, "Control exceeds tiled width: " + name)
    if pinned {
        Require(bounds.Y >= 0 && bounds.Y + bounds.Height <= height + 1, "Navigation exceeds tiled height: " + name)
    }
}

func TiledLayouts(host TestHost, window Window, adapter TestAccessibility) {
    let sizes = []int32{480, 540, 960, 270, 640, 720, 1280, 360, 960, 1080, 1920, 540}
    for i in 0 ... sizes.Length / 2 {
        let width = sizes[i * 2]
        let height = sizes[i * 2 + 1]
        host.Resize(width, height, width * 2, height * 2)
        Settle(host)
        for name in[]string{"Welcome", "Donate", "My project", "Saved work", "Profiles", "Appearance"} {
            FocusVisible(host, window, adapter, name, width, height, true)
        }
        for name in[]string{"Donate", "Saved work", "My project"} {
            Console.WriteLine("Tiling " + name + " at " + width.ToString() + "x" + height.ToString())
            Choose(host, window, adapter, name)
            if name == "My project" {
                Choose(host, window, adapter, "Contributions")
                if Find(adapter.Root, AccessibilityRole.Button, "Back to issues") != nil {
                    Choose(host, window, adapter, "Back to issues")
                }
            }
            AwaitControl(host, adapter, AccessibilityRole.Button, "Next page", enabled: true)
            FocusVisible(host, window, adapter, "Next page", width, height)
        }
        Choose(host, window, adapter, "Welcome")
        FocusVisible(host, window, adapter, "Pick up your work", width, height)
    }
    host.Resize(1440, 1000, 1440, 1000)
    Settle(host)
    Choose(host, window, adapter, "Donate")
    FocusVisible(host, window, adapter, "Next page", 1440, 1000)
}

func WorkspaceFlow() {
    let fixture = Path.Combine(Path.GetTempPath(), "tokate-workspace-" + Guid.NewGuid().ToString("N"))
    let previousPath = Environment.GetEnvironmentVariable("PATH")
    let previousState = Environment.GetEnvironmentVariable("XDG_STATE_HOME")
    Directory.CreateDirectory(fixture)
    let bin = Path.Combine(fixture, "bin")
    Directory.CreateDirectory(bin)
    let storage = Path.Combine(fixture, "tokate", "runs")
    let named = []string{"amend", "broken", "claimed", "failed", "merged"}
    for index in 0 ... 29 {
        let run = Path.Combine(storage, index < named.Length ? named[index]: "page-" + (index - 4).ToString("D3"))
        Directory.CreateDirectory(run)
        Directory.SetLastWriteTimeUtc(run, DateTime.UtcNow.AddMinutes(-index))
    }
    let checkout = Path.Combine(fixture, "checkout")
    Directory.CreateDirectory(checkout)
    Script(
        fixture,
        "git-commits",
        "cd \"$$1\" && git init -q && git config user.name t && git config user.email t@t && git config commit.gpgsign false && " +
            "git commit -q --allow-empty -m published && git rev-parse HEAD && echo x > file && git add file && " +
            "git commit -q -m 'Correct the work' && git rev-parse HEAD\n"
    )
    let commits = ProcessRunner().Run(CommandStart(Path.Combine(fixture, "git-commits"), []string{checkout}), 10).Output.Trim().Split('\n')
    File.WriteAllText(
        Path.Combine(storage, "amend", "run.json"),
        "{\"public_summary\":{\"changes\":[\"Add a fixed header row.\"],\"verification\":[\"Table tests passed.\"],\"limitations\":[]}}"
    )
    Script(
        bin,
        "tokate",
        "case \"$$1\" in\nstatus)\n  case \"$$2\" in\n  --run)\n    name=$${3##*/}\n    printf '%s\\n' \"$$3\" >> FIXTURE/saved-reads\n    if [ \"$$name\" = page-004 ]; then\n      touch FIXTURE/slow-started\n      trap 'exit 1' INT\n      while [ ! -e FIXTURE/release-page ]; do sleep .05; done\n    fi\n    case \"$$name\" in\n    claimed) state=claimed; issue=41; pr=0; reason='';;\n    failed) state=failed; issue=42; pr=0; reason=inference_failed;;\n    amend) state=published; issue=43; pr=3; reason=''; extra=',\"commit\":\"PUBLISHED\",\"artifacts\":{\"checkout\":\"FIXTURE/checkout\"}'; if [ -e FIXTURE/waiting ]; then extra=\"$$extra\"',\"amendment\":{\"state\":\"requested\",\"previous\":\"PUBLISHED\",\"commit\":\"CORRECTION\"},\"next\":{\"command\":[\"tokate\",\"amend\",\"--run\",\"FIXTURE/tokate/runs/amend\",\"--commit\",\"CORRECTION\",\"--time\",\"300s\",\"--summary\",\"/gone/summary.json\",\"--json\"]}'; fi;;\n    merged) state=published; issue=44; pr=4; reason='';;\n    page-*) state=claimed; issue=50; pr=0; reason='';;\n    *) exit 1;;\n    esac\n    data=\"{\\\"run\\\":\\\"$$3\\\",\\\"repo\\\":\\\"owner/repo\\\",\\\"issue\\\":$$issue,\\\"state\\\":\\\"$$state\\\",\\\"pr\\\":$$pr,\\\"model\\\":\\\"gpt-6.1-sol\\\",\\\"effort\\\":\\\"high\\\",\\\"failure_reason\\\":\\\"$$reason\\\"$$extra}\"\n    ;;\n  *) data='{\"work\":[{\"issue\":42,\"state\":\"owner_review\",\"drafts\":[{\"pr\":7}],\"next\":{\"role\":\"owner\",\"action\":\"Tokate workflow failed. https://github.com/owner/repo/actions/runs/7\"}}],\"access_status\":\"observed\",\"coordination\":{\"contribution\":{\"head\":\"CORRECTION\"}}}';;\n  esac;;\ndoctor) data='{\"scope\":\"repo\",\"checks\":[{\"check\":\"coordinator\",\"status\":\"ok\",\"pin\":\"v0\",\"matches_cli\":true,\"version\":\"\",\"cli_version\":\"0.7.0\",\"message\":\"Coordinator follows stable-major releases at v0.\"}],\"policy\":{\"version\":3,\"eligibility\":\"trusted\",\"allowed_tools\":[{\"harness\":\"codex\",\"provider\":\"openai\"}],\"verification\":[[\"dotnet\",\"test\"]],\"required_checks\":[\"build\"],\"max_seconds\":3600}}';;\naccess) case \"$$2\" in grant|remove|init) exit 1;; esac; data='{\"access_sha\":\"\",\"members\":[{\"donor\":\"eve\",\"trusted\":true,\"denied\":true}],\"pending\":[{\"donor\":\"alice\",\"issue\":42},{\"donor\":\"eve\",\"issue\":42}]}';;\nchecks) data='{\"gates\":{\"receipt\":{\"status\":\"passed\"}},\"checks_status\":\"passed\",\"mergeable\":false,\"target_merge_required\":true}';;\ninit)\n  printf '%s\\n' \"$$@\" > FIXTURE/owner-args\n  printf 'Setup PR includes the coordinator pin\\n' >&2\n  applied=false\n  for arg in \"$$@\"; do if [ \"$$arg\" = --yes ]; then applied=true; touch FIXTURE/applied; fi; done\n  data=\"{\\\"applied\\\":$$applied,\\\"changes\\\":[{\\\"change\\\":\\\"Setup PR\\\",\\\"old\\\":\\\"\\\",\\\"new\\\":\\\"Policy and coordinator pin\\\"}],\\\"manual\\\":[\\\"Review and merge the setup PR\\\"]}\"\n  if [ \"$$applied\" = true ]; then data=$${data%\\}}',\"pull_request\":\"https://github.com/owner/repo/pull/10\"}'; fi;;\napprove) printf '%s\\n' \"$$@\" > FIXTURE/approve-args; touch FIXTURE/approved; data='{}';;\namend)\n  printf '%s\\n' \"$$@\" > FIXTURE/amend-args\n  echo amend >> FIXTURE/amend-calls\n  rm -f FIXTURE/waiting\n  for arg in \"$$@\"; do case \"$$arg\" in */summary.json) cp \"$$arg\" FIXTURE/amend-summary;; esac; done\n  data='{}';;\n*) data='{}';;\nesac\nprintf '{\"schema_version\":1,\"command\":\"%s\",\"exit_code\":0,\"status\":\"ok\",\"data\":%s,\"next_actions\":[[\"tokate\",\"work\",\"owner/repo#%s-1\"]]}' \"$$1\" \"$$data\" \"$${issue:-42}\"\n"
            .Replace("FIXTURE", fixture)
            .Replace("PUBLISHED", commits[0])
            .Replace("CORRECTION", commits[1])
    )
    Script(
        bin,
        "gh",
        "if [ \"$$1\" = auth ]; then\n  if [ -e FIXTURE/signed-out ]; then printf '%s' '{\"hosts\":{}}'; else printf '%s' '{\"hosts\":{\"github.com\":[{\"state\":\"success\",\"active\":true}]}}'; fi\nelif [ \"$$2\" = search/issues ]; then\n  query=''\n  page=1\n  limit=0\n  for arg in \"$$@\"; do\n    case \"$$arg\" in q=*) query=$${arg#q=};; page=*) page=$${arg#page=};; per_page=*) limit=$${arg#per_page=};; esac\n  done\n  [ \"$$limit\" = 96 ] || exit 1\n  printf '%s\\n' \"$$@\" >> FIXTURE/issue-calls\n  approved=false\n  case \"$$query\" in *'-label:tokate:approved'*) ;; *'label:tokate:approved'*) approved=true;; esac\n  count=96\n  total=512\n  first=$$((42 + (page - 1) * 96))\n  case \"$$query\" in *'\"needle\"'*) count=1; total=1; first=999;; esac\n  printf '{\"total_count\":%s,\"incomplete_results\":false,\"items\":[' \"$$total\"\n  i=0\n  while [ \"$$i\" -lt \"$$count\" ]; do\n    [ \"$$i\" -eq 0 ] || printf ','\n    number=$$((first + i))\n    printf '{\"number\":%s,\"title\":\"Issue %s\",\"state\":\"open\",\"html_url\":\"https://github.com/owner/repo/issues/%s\",\"labels\":[' \"$$number\" \"$$number\" \"$$number\"\n    [ \"$$approved\" = false ] || printf '{\"name\":\"tokate:approved\"}'\n    printf ']}'\n    i=$$((i + 1))\n  done\n  printf ']}'\nelif [ \"$$2\" = repos/owner/repo/issues/42 ]; then\n  printf '%s\\n' \"$$@\" >> FIXTURE/issue-calls\n  printf '%s' '{\"number\":42,\"title\":\"Issue 42\",\"state\":\"open\",\"html_url\":\"https://github.com/owner/repo/issues/42\",\"labels\":[]}'\nelif [ \"$$2\" = user ]; then\n  printf '%s' '{\"login\":\"fixture\"}'\nelif [ \"$$1\" = pr ]; then\n  if [ \"$$3\" = 4 ]; then printf '%s' '{\"state\":\"MERGED\"}'; else printf '%s' '{\"state\":\"OPEN\",\"reviewDecision\":\"CHANGES_REQUESTED\"}'; fi\nelif [ \"$$2\" = repos/owner/repo ]; then\n  printf '%s' '{\"permissions\":{\"push\":true},\"default_branch\":\"main\"}'\nelif [ \"$$2\" = 'repos/owner/repo/issues?state=open&sort=updated&per_page=30' ]; then\n  printf '%s' '[{\"number\":42,\"title\":\"Improve rendering\",\"labels\":[]}]'\nelse\n  printf '%s' '{\"title\":\"Improve rendering\"}'\nfi\n"
            .Replace("FIXTURE", fixture)
    )
    Script(bin, "codex", "printf '%s' '{\"models\":[]}'\n")
    Script(bin, "omp", "printf '%s' '{\"models\":[]}'\n")
    Environment.SetEnvironmentVariable("PATH", bin + ":" + previousPath)
    Environment.SetEnvironmentVariable("XDG_STATE_HOME", fixture)
    try {
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
        host.Resize(1440, 1000, 1440, 1000)
        window.Attach(host)
        host.SetFocused(true)
        Settle(host)
        AwaitControl(host, adapter, AccessibilityRole.Button, "Continue owner/repo #43", enabled: true)
        Require(
            Find(adapter.Root, AccessibilityRole.Alert, "GitHub CLI is not signed in") == nil,
            "A signed-in account shows the sign-in message"
        )
        let choices = Find(adapter.Root, AccessibilityRole.Button, "Donate AI time")?.Bounds.Y
        File.WriteAllText(Path.Combine(fixture, "signed-out"), "")
        Choose(host, window, adapter, "Welcome")
        AwaitControl(host, adapter, AccessibilityRole.Alert, "GitHub CLI is not signed in")
        Require(
            Find(adapter.Root, AccessibilityRole.Button, "Donate AI time")?.Bounds.Y == choices,
            "The welcome messages moved the choices"
        )
        File.Delete(Path.Combine(fixture, "signed-out"))
        Choose(host, window, adapter, "Check again")
        let signing = System.Diagnostics.Stopwatch.StartNew()
        while Find(adapter.Root, AccessibilityRole.Alert, "GitHub CLI is not signed in") != nil && signing.Elapsed.TotalSeconds < 10 {
            Settle(host)
        }
        Require(
            Find(adapter.Root, AccessibilityRole.Alert, "GitHub CLI is not signed in") == nil,
            "Check again kept the sign-in message"
        )
        Choose(host, window, adapter, "Saved work")
        Settle(host)
        AwaitControl(host, adapter, AccessibilityRole.Status, "Needs amendment")
        Require(
            Find(adapter.Root, AccessibilityRole.Status, "Claimed, not started") != nil,
            "Missing not-started state"
        )
        Require(Find(adapter.Root, AccessibilityRole.Status, "Initial donation failed") != nil, "Missing failed state")
        Require(!FindText(adapter.Root, "owner/repo #44"), "Merged contribution remains active")
        Require(!FindText(adapter.Root, "LOCAL RUN DIRECTORIES"), "Saved work still exposes a folder list")
        let delayed = System.Diagnostics.Stopwatch.StartNew()
        while !File.Exists(Path.Combine(fixture, "slow-started")) && delayed.Elapsed.TotalSeconds < 10 {
            Settle(host)
        }
        Require(File.Exists(Path.Combine(fixture, "slow-started")), "Later pages were not read in the background")
        Choose(host, window, adapter, "Next page")
        Require(
            Find(adapter.Root, AccessibilityRole.Button, "Previous page")?.Disabled == false,
            "Loading blocks pagination"
        )
        Require(
            Find(adapter.Root, AccessibilityRole.Status, "Needs amendment") != nil &&
                Find(adapter.Root, AccessibilityRole.Status, "Loading") == nil,
            "A page showed rows before all its runs were read"
        )
        Choose(host, window, adapter, "Previous page")
        Require(
            Find(adapter.Root, AccessibilityRole.Status, "Needs amendment") != nil,
            "A read page was not shown from the cache"
        )
        File.WriteAllText(Path.Combine(fixture, "release-page"), "release")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Refresh contributions", enabled: true)
        let reads = File.ReadAllLines(Path.Combine(fixture, "saved-reads"))
        var claimReads = 0
        for path in reads {
            if path.EndsWith("/claimed") {
                claimReads++
            }
        }
        Require(claimReads == 1, "Returning to a cached page reloaded its runs")
        let fixtureReads = HashSet[string]()
        for path in reads {
            if path.StartsWith(storage) {
                fixtureReads.Add(path)
            }
        }
        Require(fixtureReads.Count == 29, "Saved work did not read every run")
        Choose(host, window, adapter, "Next page")
        Require(
            FindText(adapter.Root, "Page 2 of ") && Find(adapter.Root, AccessibilityRole.Status, "Needs amendment") == nil,
            "A read page did not show at once"
        )
        Choose(host, window, adapter, "Previous page")
        Require(
            File.ReadAllLines(Path.Combine(fixture, "saved-reads")).Length == reads.Length,
            "Page changes read cached runs again"
        )
        let browsing = desktop.Saved.Current
        let savedRun = Run.Empty with{Path = Path.Combine(storage, "amend"), Repo = "owner/repo", Issue = 43, State = "published", Pr = 3}
        desktop.Saved.Select(SavedRun.Pending(savedRun.Path) with{Run = savedRun, PullRequest = PullRequest{State: "OPEN", Conflicts: true}, Refreshed = true})
        Settle(host)
        Require(FindText(adapter.Root, "Resolve the pull request conflicts"), "Conflicts have no amendment guidance")
        Require(Find(adapter.Root, AccessibilityRole.Button, "Amend contribution") != nil, "Conflicts have no normal amendment action")
        let interrupted = savedRun with{Pr = 0, State = "failed", FailureReason = "inference_interrupted"}
        desktop.Saved.Select(SavedRun.Pending(interrupted.Path) with{Run = interrupted, Refreshed = true, Actions = []NextAction{
            NextAction{Arguments: []string{"tokate", "work", "owner/repo#43", "--continue-from", interrupted.Path, "--time", "30m", "--verify-time", "5m"}},
        }})
        Settle(host)
        Require(FindText(adapter.Root, "Interrupted") && Find(adapter.Root, AccessibilityRole.Button, "Continue with a new budget") != nil, "Interrupted work has no continuation")
        Choose(host, window, adapter, "Continue with a new budget")
        Choose(host, window, adapter, "Go back")
        desktop.Saved.Select(SavedRun.Pending(savedRun.Path) with{Run = savedRun, PullRequest = PullRequest{State: "CLOSED", Conflicts: true}, Refreshed = true, Actions = []NextAction{
            NextAction{Arguments: []string{"tokate", "checks", "--run", savedRun.Path}},
        }})
        Settle(host)
        Require(FindText(adapter.Root, "The owner closed the pull request") && Find(adapter.Root, AccessibilityRole.Button, "Check PR and CI") == nil, "Closed work still offers checks")
        let recovery = savedRun with{Pr = 0, State = "claim_pending", OwnerRecovery = true}
        desktop.Saved.Select(SavedRun.Pending(recovery.Path) with{Run = recovery, Refreshed = true})
        Settle(host)
        Require(FindText(adapter.Root, "The owner must re-run the workflow"), "Workflow failure does not name owner recovery")
        Require(Find(adapter.Root, AccessibilityRole.Button, "Check reservation") == nil && Find(adapter.Root, AccessibilityRole.Button, "Amend contribution") == nil, "Workflow failure offers a donor action")
        Require(Find(adapter.Root, AccessibilityRole.Button, "Refresh status") != nil, "Owner recovery cannot refresh status")
        desktop.Saved.Current = browsing
        desktop.Root.Refresh()
        Choose(host, window, adapter, "My project")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Refresh projects", enabled: true)
        Edit(window, host, adapter, "GitHub repository", "owner/repo")
        Choose(host, window, adapter, "Choose repository")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Issue #42: Issue 42", enabled: true)
        Require(IssueRowCount(adapter.Root) == 8, "Large issue search rendered more than one page")
        host.Resize(800, 600, 800, 600)
        Settle(host)
        guard let nextPage = Find(adapter.Root, AccessibilityRole.Button, "Next page") else {
            throw Exception("Missing issue pagination")
        }
        Require(nextPage.Bounds.Y + nextPage.Bounds.Height <= 600, "Pagination requires scrolling the page")
        Require(nextPage.Bounds.X + nextPage.Bounds.Width >= 744, "Pagination is not aligned to the right")
        host.Resize(1440, 1000, 1440, 1000)
        Settle(host)
        Choose(host, window, adapter, "Next page")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Issue #50: Issue 50", enabled: true)
        Require(IssueRowCount(adapter.Root) == 8, "Pagination appended rows instead of replacing the page")
        Require(
            Find(adapter.Root, AccessibilityRole.Button, "Issue #42: Issue 42") == nil,
            "Previous page remained mounted"
        )
        Edit(window, host, adapter, "Search issues", "needle")
        Press(window, Key.Enter)
        AwaitControl(host, adapter, AccessibilityRole.Button, "Issue #999: Issue 999", enabled: true)
        Require(IssueRowCount(adapter.Root) == 1, "Search retained stale rows")
        Require(
            FindText(adapter.Root, "1 issue") && Find(adapter.Root, AccessibilityRole.Button, "Next page") == nil,
            "Search did not reset pagination"
        )
        Edit(window, host, adapter, "Search issues", "#42")
        Press(window, Key.Enter)
        AwaitControl(host, adapter, AccessibilityRole.Button, "Issue #42: Issue 42", enabled: true)
        Require(IssueRowCount(adapter.Root) == 1, "Issue number lookup was not direct")
        Edit(window, host, adapter, "Search issues", "")
        Choose(host, window, adapter, "Approved")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Issue #42: Issue 42", enabled: true)
        Require(IssueRowCount(adapter.Root) == 8, "Approved filter did not fetch a bounded page")
        Choose(host, window, adapter, "Needs approval")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Issue #42: Issue 42", enabled: true)
        Choose(host, window, adapter, "Issue #42: Issue 42")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Approve issue #42", enabled: true)
        Require(IssueRowCount(adapter.Root) == 0, "Opening details retained the issue list")
        Choose(host, window, adapter, "Approve issue #42")
        Settle(host)
        Require(!File.Exists(Path.Combine(fixture, "approved")), "Approval ran before confirmation")
        Choose(host, window, adapter, "Go back")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Check PR #7", enabled: true)
        Require(Find(adapter.Root, AccessibilityRole.Button, "Re-run in Actions") != nil, "Failed coordinator has no Actions recovery")
        Choose(host, window, adapter, "Check PR #7")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Confirm", enabled: true)
        Choose(host, window, adapter, "Confirm")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Check PR #7", enabled: true)
        Require(FindText(adapter.Root, "Donor must amend"), "Conflicting target merge did not require donor amendment")
        File.Move(Path.Combine(bin, "tokate"), Path.Combine(bin, "tokate-base"))
        Script(bin, "tokate",
            "if [ \"$$1\" = checks ]; then\n printf '%s\\n' \"$$@\" > 'FIXTURE/check-args'\n printf '%s' '{\"schema_version\":1,\"command\":\"checks\",\"status\":\"pending\",\"exit_code\":8,\"data\":{\"gates\":{\"receipt\":{\"status\":\"pending\"}},\"checks_status\":\"unread\"},\"next_actions\":[]}'\n exit 8\nfi\nexec 'BIN/tokate-base' \"$$@\"\n".Replace("FIXTURE", fixture).Replace("BIN", bin))
        Choose(host, window, adapter, "Check PR #7")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Confirm", enabled: true)
        Require(!File.Exists(Path.Combine(fixture, "check-args")), "Checks ran before confirmation")
        Choose(host, window, adapter, "Confirm")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Check PR #7", enabled: true)
        Require(FindText(adapter.Root, "PR #7 is not ready to check yet. Check again in a minute"), "Owner pending copy is missing")
        Require(File.ReadAllText(Path.Combine(fixture, "check-args")).Contains("--yes"), "Owner checks lost consent")
        desktop.Saved.Select(SavedRun.Pending(savedRun.Path) with{Run = savedRun, Refreshed = true, Actions = []NextAction{
            NextAction{Arguments: []string{"tokate", "checks", "--run", savedRun.Path}},
        }})
        desktop.Navigation.Go(Destination.Saved)
        Settle(host)
        Choose(host, window, adapter, "Check PR and CI")
        Choose(host, window, adapter, "Confirm")
        AwaitControl(host, adapter, AccessibilityRole.Status, "PR #3 is not ready to check yet. Check again in a minute")
        Require(desktop.Saved.Current.Note.Tone == Tone.Wait, "Saved checks pending became a failure")
        desktop.Saved.Current = browsing
        desktop.Navigation.Go(Destination.Project)
        Settle(host)
        File.Delete(Path.Combine(bin, "tokate"))
        File.Move(Path.Combine(bin, "tokate-base"), Path.Combine(bin, "tokate"))
        Choose(host, window, adapter, "Back to issues")
        Choose(host, window, adapter, "Access")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Approve #42 for alice", enabled: true)
        Require(Find(adapter.Root, AccessibilityRole.Button, "Initialize access") == nil, "Empty access ref requires initialization")
        Require(Find(adapter.Root, AccessibilityRole.Button, "Approve #42 for eve") == nil && FindText(adapter.Root, "Denied"), "Denied donor request overrides deny")
        Choose(host, window, adapter, "Approve #42 for alice")
        Require(!File.Exists(Path.Combine(fixture, "approved")), "Issue access ran before confirmation")
        Choose(host, window, adapter, "Confirm")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Approve #42 for alice", enabled: true)
        Require(File.ReadAllText(Path.Combine(fixture, "approve-args")).Contains("approve\nowner/repo#42\nalice\n--base-branch\nmain\n--yes"), "Issue access approval lost positional login")
        Choose(host, window, adapter, "Setup")
        Settle(host)
        Require(FindText(adapter.Root, "dotnet test"), "Existing verification command was lost")
        Edit(window, host, adapter, "Command", "dotnet build")
        Choose(host, window, adapter, "Add command")
        Choose(host, window, adapter, "Set permissions")
        Settle(host)
        Require(
            Find(adapter.Root, AccessibilityRole.TextInput, "Model whitelist") == nil,
            "Raw policy JSON editor remains"
        )
        Choose(host, window, adapter, "Review setup")
        Require(Find(adapter.Root, AccessibilityRole.TextInput, "Local checkout") == nil, "Setup still asks for a checkout")
        Activate(window, adapter, "Pin the coordinator to this release", AccessibilityRole.Checkbox)
        Settle(host)
        Choose(host, window, adapter, "Preview setup")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Apply setup", enabled: true)
        Require(!File.Exists(Path.Combine(fixture, "applied")), "Preview applied configuration")
        Require(FindText(adapter.Root, "Proposed: Policy and coordinator pin") && FindText(adapter.Root, "Manual: Review and merge the setup PR"), "Preview omitted JSON changes or manual steps")
        Require(!FindText(adapter.Root, "Setup PR includes the coordinator pin"), "Preview duplicated stderr diagnostics")
        let previewArgs = File.ReadAllText(Path.Combine(fixture, "owner-args"))
        Require(!previewArgs.Contains("--yes") && !previewArgs.Contains("--path"), "Preview arguments apply or require a checkout")
        Require(previewArgs.Contains("--pin"), "Exact release option omitted the pin flag")
        Choose(host, window, adapter, "Apply setup")
        Choose(host, window, adapter, "Go back")
        Require(!File.Exists(Path.Combine(fixture, "applied")), "Cancel applied configuration")
        Choose(host, window, adapter, "Apply setup")
        Choose(host, window, adapter, "Confirm")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Open setup PR", enabled: true)
        Require(Find(adapter.Root, AccessibilityRole.Button, "Apply setup") == nil, "Applied setup retained the apply action")
        Require(File.Exists(Path.Combine(fixture, "applied")), "Confirm did not apply configuration")
        let args = File.ReadAllText(Path.Combine(fixture, "owner-args"))
        Require(
            args.Contains("[[\"dotnet\",\"test\"],[\"/bin/sh\",\"-c\",\"dotnet build\"]]"),
            "Editing verification replaced the existing command"
        )
        Require(
            !args.Contains("--models") && !args.Contains("--allowed-tools"),
            "Unchanged policy restrictions were replaced"
        )
        Choose(host, window, adapter, "Checks")
        Edit(window, host, adapter, "Command", "printf \"quoted\"")
        Choose(host, window, adapter, "Add command")
        Edit(window, host, adapter, "Check name", "build \"linux\"")
        Choose(host, window, adapter, "Add check")
        Choose(host, window, adapter, "Permissions")
        Choose(host, window, adapter, "Selected models")
        Edit(window, host, adapter, "Model ID", "local-model")
        for effort in []string{"Not set", "High", "Ultra"} {
            Activate(window, adapter, effort, AccessibilityRole.Checkbox)
            Settle(host)
        }
        Choose(host, window, adapter, "Add model")
        Edit(window, host, adapter, "Model ID", "discarded-model")
        Choose(host, window, adapter, "Add model")
        Choose(host, window, adapter, "Remove discarded-model")
        Choose(host, window, adapter, "Review")
        Choose(host, window, adapter, "Preview setup")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Apply setup", enabled: true)
        Require(FindText(adapter.Root, "Proposed: Policy and coordinator pin"), "Setup preview omitted JSON changes")
        Require(!FindText(adapter.Root, "Setup PR includes the coordinator pin"), "Setup preview duplicated stderr diagnostics")
        Choose(host, window, adapter, "Apply setup")
        Choose(host, window, adapter, "Confirm")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Open setup PR", enabled: true)
        let updated = File.ReadAllLines(Path.Combine(fixture, "owner-args"))
        using let commands = JsonDocument.Parse(updated[Array.IndexOf(updated, "--verification") + 1])
        using let checks = JsonDocument.Parse(updated[Array.IndexOf(updated, "--required-checks") + 1])
        using let tools = JsonDocument.Parse(updated[Array.IndexOf(updated, "--allowed-tools") + 1])
        let models = tools.RootElement[0].GetProperty("models")
        Require(commands.RootElement[2][2].GetString() == "printf \"quoted\"", "Command JSON lost quoting")
        Require(checks.RootElement[1].GetString() == "build \"linux\"", "Check JSON lost quoting")
        Require(models.GetProperty("local-model")[1].GetString() == "ultra", "Model efforts changed")
        Require(!models.TryGetProperty("discarded-model", out _), "Removed model remained serialized")
        let cliPath = Path.Combine(bin, "tokate")
        let withPolicy = File.ReadAllText(cliPath)
        File.WriteAllText(cliPath, withPolicy.Replace("\"policy\":{", "\"unavailable_policy\":{"))
        Choose(host, window, adapter, "Change project")
        Choose(host, window, adapter, "Choose repository")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Preview setup", enabled: true)
        Require(FindText(adapter.Root, "No policy yet."), "Missing policy was not treated as initial setup")
        File.WriteAllText(cliPath, withPolicy)
        Choose(host, window, adapter, "Change project")
        Script(bin, "tokate", "printf '%s' '{\"schema_version\":1,\"command\":\"doctor\",\"status\":\"ok\",\"exit_code\":0,\"data\":{\"tools\":[{\"name\":\"gh-auth\",\"status\":\"ready\",\"detail\":\"GitHub identity verified\"}]}}'\n")
        Choose(host, window, adapter, "Check owner prerequisites")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Check owner prerequisites", enabled: true)
        Require(FindText(adapter.Root, "GitHub identity verified"), "Owner prerequisites report was not displayed")
        File.WriteAllText(cliPath, withPolicy)
        Choose(host, window, adapter, "Choose repository")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Contributions", enabled: true)
        Choose(host, window, adapter, "Contributions")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Issue #42: Issue 42", enabled: true)
        Choose(host, window, adapter, "Donate")
        Edit(window, host, adapter, "GitHub repository", "owner/repo")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Choose repository", enabled: true)
        Choose(host, window, adapter, "Choose repository")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Issue #42: Issue 42", enabled: true)
        Require(IssueRowCount(adapter.Root) == 8, "Donate did not use the bounded issue browser")
        let requests = File.ReadAllText(Path.Combine(fixture, "issue-calls"))
        Require(
            requests.Contains("per_page=96") && !requests.Contains("page=2") && !requests.Contains("--paginate"),
            "Issue search did not fetch one bounded batch of pages"
        )
        Require(
            requests.Contains("-label:tokate:approved") && requests.Contains("is:issue is:open label:tokate:approved"),
            "Search filters were not sent to GitHub"
        )
        Require(requests.Contains("repos/owner/repo/issues/42"), "Number search scanned issue pages")
        TiledLayouts(host, window, adapter)
        Choose(host, window, adapter, "Issue #42: Issue 42")
        AwaitControl(host, adapter, AccessibilityRole.Button, "More verification share", enabled: true)
        desktop.Donation.SetVerification("7")
        Settle(host)
        Choose(host, window, adapter, "Saved work")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Saved owner/repo #43", enabled: true)
        Choose(host, window, adapter, "Saved owner/repo #43")
        Choose(host, window, adapter, "Amend contribution")
        AwaitControl(host, adapter, AccessibilityRole.TextInput, "Change 1", "Add a fixed header row.")
        Require(
            Find(adapter.Root, AccessibilityRole.TextInput, "Verification minutes")?.Value == "30",
            "Donation budget leaked into amendment settings"
        )
        Edit(window, host, adapter, "Verification minutes", "11")
        Choose(host, window, adapter, "Donate")
        Require(
            desktop.Donation.Current.Draft.Verification == "7",
            "Amendment changed the donation budget"
        )
        Choose(host, window, adapter, "Saved work")
        Require(
            Find(adapter.Root, AccessibilityRole.TextInput, "Verification minutes")?.Value == "11",
            "Navigation discarded amendment settings"
        )
        AwaitControl(host, adapter, AccessibilityRole.Button, "Add change", enabled: true)
        Choose(host, window, adapter, "Add change")
        Edit(window, host, adapter, "Change 2", "Fix the table header.")
        let first = Find(adapter.Root, AccessibilityRole.TextInput, "Change 1") ?? throw Exception("Missing first change")
        Require(window.PerformAccessibilityAction(first.Id, AccessibilityActionRequest(AccessibilityAction.Focus)), "Cannot focus the first change")
        Settle(host)
        Choose(host, window, adapter, "Remove change 1")
        Require(
            Find(adapter.Root, AccessibilityRole.TextInput, "Change 1")?.Value == "Fix the table header." &&
                Find(adapter.Root, AccessibilityRole.TextInput, "Change 2") == nil,
            "Removing the focused line left its text in the next line: " + (Find(adapter.Root, AccessibilityRole.TextInput, "Change 1")?.Value ?? "none")
        )
        Choose(host, window, adapter, "Verify and publish amendment")
        Choose(host, window, adapter, "Confirm")
        let expectedSummary = "{\"head\":\"" + commits[1] +
            "\",\"changes\":[\"Fix the table header.\"],\"verification\":[\"Table tests passed.\"],\"limitations\":[]}"
        let published = System.Diagnostics.Stopwatch.StartNew()
        while (!File.Exists(Path.Combine(fixture, "amend-summary")) ||
            File.ReadAllText(Path.Combine(fixture, "amend-summary")) != expectedSummary) && published.Elapsed.TotalSeconds < 10 {
            Settle(host)
        }
        Require(
            File.ReadAllText(Path.Combine(fixture, "amend-summary")) ==
                "{\"head\":\"" + commits[1] +
                "\",\"changes\":[\"Fix the table header.\"],\"verification\":[\"Table tests passed.\"],\"limitations\":[]}",
            "Amendment did not publish the corrected summary for the commit"
        )
        let amended = File.ReadAllText(Path.Combine(fixture, "amend-args"))
        Require(
            amended.Contains("--time\n11m\n--commit\n" + commits[1] + "\n--summary\n") && !amended.Contains("--tools"),
            "Amendment arguments are wrong: " + amended
        )
        AwaitControl(host, adapter, AccessibilityRole.Status, "The pull request has the amendment.")
        Require(
            File.ReadAllLines(Path.Combine(fixture, "amend-calls")).Length == 2,
            "The amendment command did not run again after the coordinator recorded the request"
        )
        Choose(host, window, adapter, "Welcome")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Continue owner/repo #43", enabled: true)
        Choose(host, window, adapter, "Continue owner/repo #43")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Amend contribution", enabled: true)
        let record = Path.Combine(storage, "amend", "amendments", commits[1])
        Directory.CreateDirectory(record)
        File.WriteAllText(
            Path.Combine(record, "run.json"),
            "{\"state\":\"requested\",\"tools\":[],\"public_summary\":{\"changes\":[\"Fix the table header again.\"],\"verification\":[],\"limitations\":[]}}"
        )
        File.WriteAllText(Path.Combine(fixture, "waiting"), "")
        Choose(host, window, adapter, "Welcome")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Continue owner/repo #43", enabled: true)
        Choose(host, window, adapter, "Continue owner/repo #43")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Confirm", enabled: true)
        Choose(host, window, adapter, "Confirm")
        let saved = "{\"head\":\"" + commits[1] + "\",\"changes\":[\"Fix the table header again.\"],\"verification\":[],\"limitations\":[]}"
        let resumed = System.Diagnostics.Stopwatch.StartNew()
        while File.ReadAllText(Path.Combine(fixture, "amend-summary")) != saved && resumed.Elapsed.TotalSeconds < 20 {
            Settle(host)
        }
        Require(
            File.ReadAllText(Path.Combine(fixture, "amend-summary")) == saved &&
                File.ReadAllText(Path.Combine(fixture, "amend-args")).Contains("--time\n300s\n--summary\n"),
            "A saved amendment that waits for the coordinator did not finish with its saved summary: " +
                File.ReadAllText(Path.Combine(fixture, "amend-args"))
        )
        AwaitControl(host, adapter, AccessibilityRole.Status, "The pull request has the amendment.")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Amend contribution", enabled: true)
        let unpublished = Path.Combine(storage, "unpublished")
        Directory.CreateDirectory(unpublished)
        File.WriteAllText(Path.Combine(unpublished, "run.json"), "{\"public_summary\":{\"changes\":[\"Fix the table header.\"],\"verification\":[],\"limitations\":[]}}")
        File.Move(Path.Combine(bin, "tokate"), Path.Combine(bin, "tokate-published"))
        Script(
            bin,
            "tokate",
            "if [ \"$$1\" = status ] && [ \"$$3\" = 'RUN' ]; then\n  printf '%s' '{\"schema_version\":1,\"command\":\"status\",\"exit_code\":0,\"status\":\"ok\",\"data\":{\"run\":\"RUN\",\"repo\":\"owner/repo\",\"issue\":45,\"state\":\"failed\",\"failure_reason\":\"verification_failed\",\"pr\":0,\"commit\":\"ORIGINAL\",\"artifacts\":{\"checkout\":\"CHECKOUT\"}},\"next_actions\":[]}'\nelif [ \"$$1\" = amend ] && [ \"$$3\" = 'RUN' ] && [ \"$$4\" = --yes ] && [ \"$$5\" = --json ]; then\n  printf '%s\\n' \"$$@\" > 'FIXTURE/archive-args'\n  printf '%s' '{\"schema_version\":1,\"command\":\"amend\",\"exit_code\":0,\"status\":\"ok\",\"data\":{},\"next_actions\":[]}'\nelse\n  exec 'BIN/tokate-published' \"$$@\"\nfi\n"
                .Replace("RUN", unpublished)
                .Replace("ORIGINAL", commits[0])
                .Replace("CHECKOUT", checkout)
                .Replace("FIXTURE", fixture)
                .Replace("BIN", bin)
        )
        using let original = System.Diagnostics.Process.Start("git", "-C \"" + checkout + "\" checkout --detach " + commits[0])
        original.WaitForExit()
        Require(original.ExitCode == 0, "Could not prepare the original unpublished checkout")
        Choose(host, window, adapter, "Saved work")
        Choose(host, window, adapter, "Back to contributions")
        Choose(host, window, adapter, "Refresh contributions")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Saved owner/repo #45", enabled: true)
        Choose(host, window, adapter, "Saved owner/repo #45")
        Choose(host, window, adapter, "Amend contribution")
        Choose(host, window, adapter, "Confirm")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Check again", enabled: true)
        Require(
            File.ReadAllText(Path.Combine(fixture, "archive-args")) == "amend\n--run\n" + unpublished + "\n--yes\n--json\n",
            "Unpublished amendment did not archive evidence without a commit or budget"
        )
        Require(
            Find(adapter.Root, AccessibilityRole.Button, "Verify and publish amendment")?.Disabled == true,
            "Unpublished amendment can verify before a corrected commit exists"
        )
        using let edited = System.Diagnostics.Process.Start("git", "-C \"" + checkout + "\" checkout --detach " + commits[1])
        edited.WaitForExit()
        Require(edited.ExitCode == 0, "Could not select the edited unpublished checkout")
        Choose(host, window, adapter, "Check again")
        AwaitControl(host, adapter, AccessibilityRole.TextInput, "Change 1", "Fix the table header.")
        Edit(window, host, adapter, "Verification minutes", "9")
        Choose(host, window, adapter, "Verify and publish amendment")
        Choose(host, window, adapter, "Confirm")
        let verified = System.Diagnostics.Stopwatch.StartNew()
        while desktop.Saved.Current.Note.Message != "The pull request has the amendment." && verified.Elapsed.TotalSeconds < 75 {
            Settle(host)
        }
        AwaitControl(host, adapter, AccessibilityRole.Status, "The pull request has the amendment.")
        Require(
            File.ReadAllText(Path.Combine(fixture, "amend-args")).Contains("--time\n9m\n--commit\n" + commits[1]),
            "Unpublished amendment did not verify the edited checkout HEAD: " + File.ReadAllText(Path.Combine(fixture, "amend-args"))
        )
        ReviewSubmitFlow(host, window, adapter, desktop, fixture, bin)
    } finally {
        Environment.SetEnvironmentVariable("PATH", previousPath)
        Environment.SetEnvironmentVariable("XDG_STATE_HOME", previousState)
        Directory.Delete(fixture, true)
    }
}

func ReviewSubmitFlow(host TestHost, window Window, adapter TestAccessibility, desktop DesktopApp, fixture string, bin string) {
    let executable = Path.Combine(bin, "tokate")
    let previous = File.ReadAllText(executable)
    let run = Path.Combine(fixture, "review-run")
    Directory.CreateDirectory(run)
    Script(bin, "tokate",
        ("case \"$$1\" in\n" +
        "submit)\n printf '%s\\n' \"$$@\" > FIXTURE/review-args\n" +
        " if [ -e FIXTURE/review-refused ]; then data='{\"applied\":false}'; elif [ \"$$4\" = --yes ]; then touch FIXTURE/review-published; data='{\"applied\":true,\"pr\":9}'; else data='{\"applied\":false,\"pull_request\":{\"title\":\"Improve rendering\",\"body\":\"Changes\\nA plain text summary.\",\"base\":\"main\",\"head\":\"tokate/review\"}}'; fi;;\n" +
        "status)\n pr=0; state=generated; if [ -e FIXTURE/review-published ]; then pr=9; state=published; fi\n data=\"{\\\"run\\\":\\\"RUN\\\",\\\"gratis\\\":true,\\\"repo\\\":\\\"owner/repo\\\",\\\"issue\\\":46,\\\"state\\\":\\\"$$state\\\",\\\"pr\\\":$$pr}\";;\n" +
        "*) data='{}';;\nesac\n" +
        "printf '{\"schema_version\":1,\"command\":\"%s\",\"exit_code\":0,\"status\":\"ok\",\"data\":%s,\"next_actions\":[[\"tokate\",\"submit\",\"--run\",\"RUN\"]]}' \"$$1\" \"$$data\"\n")
            .Replace("FIXTURE", fixture).Replace("RUN", run)
    )
    try {
        desktop.Saved.SetRunPath(run)
        desktop.Saved.LoadRun()
        AwaitControl(host, adapter, AccessibilityRole.Button, "Review pull request", enabled: true)
        Choose(host, window, adapter, "Review pull request")
        AwaitControl(host, adapter, AccessibilityRole.Button, "Publish pull request", enabled: true)
        Require(FindText(adapter.Root, "Improve rendering") && FindText(adapter.Root, "main <- tokate/review") && FindText(adapter.Root, "A plain text summary."), "Review omitted pull request content")
        Require(!File.Exists(Path.Combine(fixture, "review-published")), "Review published the pull request")
        Require(!File.ReadAllText(Path.Combine(fixture, "review-args")).Contains("--yes"), "Review passed publication consent")
        Require(desktop.Saved.Current.Run.Pr == 0 && desktop.Saved.Current.Review != nil, "Preview reported publication")
        Choose(host, window, adapter, "Publish pull request")
        Require(!File.Exists(Path.Combine(fixture, "review-published")), "Publish bypassed confirmation")
        Choose(host, window, adapter, "Go back")
        Require(desktop.Saved.Current.Review != nil, "Cancel discarded the review")
        File.WriteAllText(Path.Combine(fixture, "review-refused"), "")
        Choose(host, window, adapter, "Publish pull request")
        desktop.Dialogs.Confirm()
        AwaitControl(host, adapter, AccessibilityRole.Status, "The pull request was not published. Review it before trying again.")
        Require(desktop.Saved.Current.Review != nil && desktop.Saved.Current.Run.Pr == 0, "Unapplied publish reported success")
        File.Delete(Path.Combine(fixture, "review-refused"))
        Choose(host, window, adapter, "Publish pull request")
        desktop.Dialogs.Confirm()
        AwaitControl(host, adapter, AccessibilityRole.Button, "Open pull request", enabled: true)
        Require(File.ReadAllText(Path.Combine(fixture, "review-args")).Contains("--yes"), "Publication omitted consent")
        Require(desktop.Saved.Current.Review == nil, "Publication retained the preview")
    } finally {
        File.WriteAllText(executable, previous)
    }
}
