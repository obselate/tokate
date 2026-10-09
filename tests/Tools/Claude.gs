package TokateTests

import System
import System.IO

internal class ClaudeTool {
    shared {
        internal func Run(args[]string) int32 {
            let profile = Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR") ?? ""
            if String.Join(" ", args) == "--restricted --safe-mode auth login" {
                File.WriteAllText(Path.Combine(profile, ".claude.json"), "normal")
                File.WriteAllText(
                    Path.Combine(profile, ".credentials.json"),
                    Check.Map(
                        "loggedIn",
                        true,
                        "authMethod",
                        "claude.ai",
                        "apiProvider",
                        "firstParty",
                        "subscriptionType",
                        "pro"
                    )
                        .ToJsonString()
                )
                Console.WriteLine("Native fixture sign-in complete")
                return 0
            }
            let mode = File.ReadAllText(Path.Combine(profile, ".claude.json"))
            if args.Length == 3 && args[2] == "--version" {
                Console.WriteLine("100.0.0 (Claude Code)")
                return 0
            }
            if args.Length == 3 && args[2] == "--help" {
                for flag in[]string{
                    "--restricted",
                    "--safe-mode",
                    "--setting-sources",
                    "--strict-mcp-config",
                    "--mcp-config",
                    "--disable-slash-commands",
                    "--no-chrome",
                    "--tools",
                    "--allowedTools",
                    "--permission-mode",
                    "--permission-prompts",
                    "--settings",
                    "--model",
                    "--effort",
                    "--no-session-persistence",
                    "--output-format",
                    "--verbose",
                    "--print"
                } {
                    if mode != "missing" || flag != "--permission-prompts" {
                        Console.WriteLine("  " + flag + " synthetic documented interface")
                    }
                }
                return 0
            }
            if Array.IndexOf(args, "--print") >= 0 {
                let prompt = Console.In.ReadToEnd()
                Check.Contains(prompt, "Acceptance criteria")
                let model = args[Array.IndexOf(args, "--model") + 1]
                let effort = args[Array.IndexOf(args, "--effort") + 1]
                Check.That(
                    Array.IndexOf(args, "--restricted") >= 0 && Array.IndexOf(args, "--safe-mode") >= 0,
                    "Managed Claude lost native restrictions"
                )
                Check.That(
                    Environment.GetEnvironmentVariable("GH_TOKEN") == nil && Environment.GetEnvironmentVariable(
                        "OPENAI_API_KEY"
                    ) == nil,
                    "Managed Claude inherited host credentials"
                )
                File.WriteAllText("result.txt", "Claude fixture completed\n")
                File.WriteAllText(
                    "tokate-public-summary.json",
                    "{\"changes\":[\"Add a result containing the fixture completion text.\"],\"verification\":[],\"limitations\":[]}"
                )
                Console.WriteLine(
                    Check.Map(
                        "type",
                        "system",
                        "subtype",
                        "init",
                        "model",
                        model,
                        "effort",
                        effort,
                        "permissionMode",
                        "default"
                    )
                        .ToJsonString()
                )
                Console.WriteLine(
                    Check.Map(
                        "type",
                        "assistant",
                        "message",
                        Check.Map("model", mode == "conflict" ? "claude-sonnet-4-6": model, "stop_reason", "end_turn")
                    )
                        .ToJsonString()
                )
                if mode != "incomplete" {
                    Console.WriteLine(
                        Check.Map(
                            "type",
                            "result",
                            "subtype",
                            mode == "failed" ? "error_during_execution": "success",
                            "is_error",
                            mode == "failed",
                            "result",
                            "Claude fixture completed.",
                            "usage",
                            Check.Map("input_tokens", 12, "output_tokens", 3, "cache_read_input_tokens", 4)
                        )
                            .ToJsonString()
                    )
                }
                return 0
            }
            Check.That(
                String.Join(" ", args) == "--restricted --safe-mode auth status --json",
                "Auth status was not standalone restricted safe mode"
            )
            Check.That(
                !Directory.Exists(Path.Combine(Directory.GetCurrentDirectory(), ".git")),
                "Auth status was exposed to a repository"
            )
            Console.Write(File.ReadAllText(Path.Combine(profile, ".credentials.json")))
            return mode == "exit" ? 1: 0
        }
    }
}
