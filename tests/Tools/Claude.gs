package TokateTests

import System
import System.IO
import System.Text

internal class ClaudeTool {
    shared {
        internal func Run(args[]string) int32 {
            let profile = Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR") ?? Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                ".claude"
            )
            if args.Length == 1 && args[0] == "--version" {
                Console.WriteLine("100.0.0 (Claude Code)")
                return 0
            }
            if args.Length == 1 && args[0] == "--help" {
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
                    Console.WriteLine("  " + flag + " synthetic documented interface")
                }
                return 0
            }
            let modePath = Path.Combine(profile, ".claude.json")
            let mode = File.Exists(modePath) ? File.ReadAllText(modePath): "normal"
            if Array.IndexOf(args, "--print") >= 0 {
                let prompt = Console.In.ReadToEnd()
                Check.Contains(prompt, "Acceptance criteria")
                let model = args[Array.IndexOf(args, "--model") + 1]
                let effort = args[Array.IndexOf(args, "--effort") + 1]
                Check.That(
                    Array.IndexOf(args, "--restricted") < 0 && Array.IndexOf(args, "--safe-mode") < 0 && Array.IndexOf(
                        args,
                        "--tools"
                    ) < 0 &&
                        Array.IndexOf(args, "--strict-mcp-config") < 0,
                    "Managed Claude disabled donor configuration or tools"
                )
                let settings = Check.Json(args[Array.IndexOf(args, "--settings") + 1])
                Check.That(
                    (settings["availableModels"]?.ToJsonString() ?? "").Contains("\"" + model + "\""),
                    "Managed Claude settings omitted the owner's allowed models"
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
                        "parent_tool_use_id",
                        "configured-agent",
                        "message",
                        Check.Map("model", "claude-haiku-5-5", "stop_reason", "end_turn")
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
                            Check.Map("input_tokens", 12, "output_tokens", 3, "cache_read_input_tokens", 4),
                            "modelUsage",
                            Check.Map(
                                model,
                                Check.Map("inputTokens", 10),
                                "claude-haiku-5-5",
                                Check.Map("inputTokens", 2)
                            )
                        )
                            .ToJsonString()
                    )
                }
                return 0
            }
            Check.That(
                String.Join(" ", args) == "auth status",
                "Tokate must only inspect native authentication, never start its own login flow"
            )
            Check.That(
                !Directory.Exists(Path.Combine(Directory.GetCurrentDirectory(), ".git")),
                "Auth status was exposed to a repository"
            )
            let credentials = Path.Combine(profile, ".credentials.json")
            if !File.Exists(credentials) {
                Console.WriteLine(
                    Check.Map("loggedIn", false, "authMethod", "none", "apiProvider", "firstParty").ToJsonString()
                )
                return 1
            }
            Console.Write(File.ReadAllText(credentials))
            return mode == "exit" ? 1: 0
        }
    }
}
