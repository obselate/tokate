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
        "select --repo o/r --harness codex --model gpt-6.1-sol --effort high --non-interactive",
        "select arguments"
    )
    Regression.Equal(
        Regression.Args(TokateCommands.Select("o/r", draft with{Profile = "fast"})),
        "select --repo o/r --profile fast --non-interactive",
        "select with a profile"
    )
    let pi = draft with{Harness = "pi", Model = " qwen ", Effort = "absent", Endpoint = " http://127.0.0.1:8080/v1 ", Network = true}
    Regression.Equal(
        Regression.Args(TokateCommands.Claim("o/r", pi with{Profile = "local"}, "42", 3600)),
        "claim --repo o/r --profile local --harness pi --model qwen --effort absent --endpoint http://127.0.0.1:8080/v1 --non-interactive --seconds 3600 --issue 42 --verification-reserve 1800 --allow-network",
        "claim arguments"
    )
    Regression.Equal(
        Regression.Args(TokateCommands.Claim("o/r", draft with{Unlimited = true}, "42", 1800)),
        "claim --repo o/r --harness codex --model gpt-6.1-sol --effort high --non-interactive --unlimited --issue 42 --verification-reserve 1800",
        "unlimited claim arguments"
    )
    Regression.Equal(
        Regression.Args(TokateCommands.Access("o/r", "grant", "alice", "42")),
        "access --repo o/r --operation grant --donor alice --issue 42",
        "access arguments"
    )
    Regression.Equal(Regression.Args(TokateCommands.Access("o/r", "list")), "access --repo o/r --operation list", "access list")

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
        ModelPolicy = "whitelist",
        Models = []ModelAllowance{ModelAllowance{Model: "gpt", Efforts: []string{"high"}}},
        Minutes = "30",
        Network = "deny",
        Tools = "codex,pi",
        Eligibility = "open",
    }
    Regression.Equal(
        Regression.Args(TokateCommands.Init("o/r", setup)),
        "init --repo o/r --path /work/repo --non-interactive --verification [[\"/bin/sh\",\"-c\",\"dotnet test\"]] --required-checks [\"build\"] --model-policy whitelist --seconds 1800 --network deny --models {\"gpt\":[\"high\"]} --allowed-tools codex,pi --eligibility open",
        "init arguments"
    )
    Regression.Equal(
        Regression.Args(TokateCommands.Init("o/r", SetupDraft.From(Policy.Empty with{Loaded = true}) with{Path = "/p"})),
        "init --repo o/r --path /p --non-interactive",
        "unchanged init arguments"
    )
    Regression.Equal(Regression.Args(TokateCommands.Apply([]string{"init"})), "init --yes", "apply adds consent")

    let amendment = AmendmentDraft.Initial with{
        Commit = "0123456789abcdef0123456789abcdef01234567",
        Summary = "/tmp/summary.json",
        Verification = "7",
    }
    Regression.Equal(
        Regression.Args(TokateCommands.RunAction(RunAction.Amend, "/runs/1", amendment)),
        "amend --run /runs/1 --seconds 420 --commit 0123456789abcdef0123456789abcdef01234567 --summary /tmp/summary.json",
        "amend arguments"
    )
    Regression.Equal(
        Regression.Args(TokateCommands.RunAction(RunAction.Submit, "/runs/1", amendment)),
        "submit --run /runs/1",
        "submit arguments"
    )
    Regression.Check(TokateCommands.RunActionTimeout(RunAction.Recover, amendment) == 540, "recover timeout")
    Regression.Check(TokateCommands.RunActionTimeout(RunAction.Checks, amendment) == 600, "default timeout")

    let listing = IssueListing.Empty(IssueFilter.NeedsApproval) with{AppliedQuery = "empty \"results\""}
    Regression.Equal(
        Regression.Args(GitHubCommands.SearchIssues("o/r", listing, 2)),
        "api search/issues --method GET -f q=repo:o/r is:issue is:open -label:tokate:approved in:title \"empty\" \"results\" -f sort=updated -f order=desc -f per_page=8 -f page=2",
        "issue search arguments"
    )
    Regression.Equal(
        Regression.Args(GitHubCommands.SearchIssues("o/r", listing with{AppliedQuery = "#12"}, 1)),
        "api repos/o/r/issues/12",
        "issue number lookup"
    )
}
