package TokateDesktop

import System
import System.Collections.Generic
import System.Text.Json.Nodes

func NodeArray(values IEnumerable[string]) JsonArray {
    let result = JsonArray()
    for value in values {
        result.Add(JsonValue.Create(value) as JsonNode)
    }
    return result
}

func CommandTests() {
    let draft = DonationDraft.Initial
    Regression.Equal(
        Regression.Args(TokateCommands.Select("o/r", draft)),
        "select o/r --harness codex --model gpt-6.1-sol --effort high --non-interactive",
        "select arguments"
    )
    Regression.Equal(
        Regression.Args(TokateCommands.Select("o/r", draft with{Profile = "fast"})),
        "select o/r fast --non-interactive",
        "select with a profile"
    )
    Regression.Equal(
        Regression.Args(
            TokateCommands.DefaultsSet(
                "fast",
                draft with{Harness = "omp", Provider = " openrouter ", Model = "a/b", Effort = "low", Profile = "old"}
            )
        ),
        "defaults set fast --harness omp --model a/b --effort low --provider openrouter",
        "save a profile"
    )
    let pi = draft with{Harness = "pi", Model = " qwen ", Effort = "absent", Endpoint = " http://127.0.0.1:8080/v1 "}
    Regression.Equal(
        Regression.Args(TokateCommands.Claim("o/r", pi with{Profile = "local"}, "42", 3600)),
        "claim o/r#42 local --harness pi --model qwen --effort absent --endpoint http://127.0.0.1:8080/v1 --non-interactive --time 3600s --verify-time 30m",
        "claim arguments"
    )
    Regression.Equal(
        Regression.Args(TokateCommands.Claim("o/r", draft with{Unlimited = true}, "42", 1800)),
        "claim o/r#42 --harness codex --model gpt-6.1-sol --effort high --non-interactive --unlimited --verify-time 30m",
        "unlimited claim arguments"
    )
    Regression.Equal(
        Regression.Args(TokateCommands.Access("o/r", "grant", "alice", "42")),
        "access grant alice o/r#42",
        "access arguments"
    )
    Regression.Equal(Regression.Args(TokateCommands.Access("o/r", "list")), "access list o/r", "access list")

    let tricky = []string{"a\"b", "ü", "<b>&", "line\nbreak", "back\\slash"}
    Regression.Equal(Json.StringArray(tricky), NodeArray(tricky).ToJsonString(), "string arrays match the previous encoder")
    let nested = JsonArray()
    nested.Add(NodeArray(tricky) as JsonNode)
    Regression.Equal(Json.NestedArrays([][]string{tricky}), nested.ToJsonString(), "nested arrays match the previous encoder")
    let entries = JsonObject()
    entries["m\"x"] = NodeArray([]string{"high"})
    Regression.Equal(
        Json.StringListMap([]ModelAllowance{ModelAllowance{Model: "m\"x", Efforts: []string{"high"}}}),
        entries.ToJsonString(),
        "model maps match the previous encoder"
    )

    let setup = SetupDraft.From(Policy.Empty with{Loaded = true}) with{
        Path = "/work/repo",
        Commands = [][]string{[]string{"/bin/sh", "-c", "dotnet test"}},
        CommandsChanged = true,
        Checks = []string{"build"},
        ChecksChanged = true,
        ToolModels = []ToolAllowance{ToolAllowance{
            Tool: "codex/openai",
            Models: []ModelAllowance{ModelAllowance{Model: "gpt", Efforts: []string{"high"}}},
            Restricted: true,
        }},
        PermissionsChanged = true,
        Minutes = "30",
        Tools = "codex/openai,omp/openrouter",
        Eligibility = "open",
    }
    Regression.Equal(
        Regression.Args(TokateCommands.Init("o/r", setup)),
        "init o/r --path /work/repo --non-interactive --verification [[\"/bin/sh\",\"-c\",\"dotnet test\"]] --required-checks [\"build\"] --max-time 30m --allowed-tools [{\"harness\":\"codex\",\"provider\":\"openai\",\"models\":{\"gpt\":[\"high\"]}},{\"harness\":\"omp\",\"provider\":\"openrouter\"}] --eligibility open",
        "init arguments"
    )
    Regression.Equal(
        Regression.Args(TokateCommands.Init("o/r", SetupDraft.From(PolicyCodec.FromPolicyResult(Regression.Fixture("policy.json"))) with{Path = "/p"})),
        "init o/r --path /p --non-interactive",
        "unchanged init leaves upstream tool permissions untouched"
    )
    Regression.Equal(Regression.Args(TokateCommands.OwnerDoctor("o/r")), "doctor owner o/r --auth", "owner repository health")
    Regression.Equal(
        Regression.Args(TokateCommands.Approve("o/r", "42", "main")),
        "approve o/r#42 --base-branch main --yes",
        "confirmed approval can replace stale authority"
    )
    Regression.Equal(
        Regression.Args(TokateCommands.CoordinatorSetup("o/r", "/p/new.yml")),
        "coordinator-setup o/r --output /p/new.yml --non-interactive",
        "coordinator preview does not apply"
    )
    Regression.Equal(
        Regression.Args(TokateCommands.CoordinatorSetup("o/r", "/p/new.yml", true)),
        "coordinator-setup o/r --output /p/new.yml --non-interactive --yes",
        "confirmed coordinator apply"
    )

    let amendment = AmendmentDraft.Initial with{
        Commit = "0123456789abcdef0123456789abcdef01234567",
        Edited = EditedBy.Donation,
        Verification = "7",
    }
    Regression.Equal(
        Regression.Args(TokateCommands.RunAction(RunAction.Amend, "/runs/1", amendment, files: "/tmp/a")),
        "amend --run /runs/1 --time 7m --commit 0123456789abcdef0123456789abcdef01234567 --summary /tmp/a/summary.json --tools /tmp/a/tools.json",
        "amend arguments"
    )
    Regression.Equal(
        Regression.Args(
            TokateCommands.RunAction(RunAction.Amend, "/runs/1", amendment with{Edited = EditedBy.Other, Tools = "/tmp/tools.json"}, files: "/tmp/a")
        ),
        "amend --run /runs/1 --time 7m --commit 0123456789abcdef0123456789abcdef01234567 --summary /tmp/a/summary.json --tools /tmp/tools.json",
        "amend arguments with a tool declarations file"
    )
    Regression.Equal(
        Regression.Args(TokateCommands.RunAction(RunAction.Submit, "/runs/1", amendment)),
        "submit --run /runs/1",
        "submit arguments"
    )
    Regression.Check(TokateCommands.RunActionTimeout(RunAction.Amend, amendment) == 540, "amend timeout")
    Regression.Check(TokateCommands.RunActionTimeout(RunAction.Checks, amendment) == 600, "default timeout")

    let listing = IssueListing.Empty(IssueFilter.NeedsApproval) with{AppliedQuery = "empty \"results\""}
    Regression.Equal(
        Regression.Args(GitHubCommands.SearchIssues("o/r", listing, 2)),
        "api search/issues --method GET -f q=repo:o/r is:issue is:open -label:tokate:approved in:title \"empty\" \"results\" -f sort=updated -f order=desc -f per_page=96 -f page=2",
        "issue search arguments"
    )
    Regression.Equal(
        Regression.Args(GitHubCommands.SearchIssues("o/r", listing with{AppliedQuery = "#12"}, 1)),
        "api repos/o/r/issues/12",
        "issue number lookup"
    )
}
