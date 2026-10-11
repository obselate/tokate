package TokateTests

import System
import System.IO

internal class OmpTool {
    shared {
        internal let Model string = "~vendor/proof-model"

        internal func Run(args[]string) int32 {
            let settings = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".omp")
            let modePath = Path.Combine(settings, "mode")
            let mode = File.Exists(modePath) ? File.ReadAllText(modePath).Trim(): "normal"
            if args.Length == 1 && args[0] == "--version" {
                Console.WriteLine("omp/100.0.0")
                return 0
            }
            if String.Join(" ", args) == "models --json" {
                Check.That(
                    !Directory.Exists(Path.Combine(Directory.GetCurrentDirectory(), ".git")),
                    "Model metadata was read inside a repository"
                )
                let models = Check.Json("[]").AsArray()
                if mode != "empty" {
                    models.Add(
                        Check.Map(
                            "provider",
                            "openrouter",
                            "kind",
                            "chat",
                            "id",
                            Model,
                            "selector",
                            "openrouter/" + Model,
                            "contextWindow",
                            200000,
                            "maxTokens",
                            16000,
                            "reasoning",
                            true,
                            "thinking",
                            Check.Json("[\"low\",\"high\"]")
                        )
                    )
                    models.Add(
                        Check.Map(
                            "provider",
                            "llama.cpp",
                            "kind",
                            "chat",
                            "id",
                            "plain",
                            "selector",
                            "llama.cpp/plain",
                            "contextWindow",
                            32000,
                            "maxTokens",
                            4096,
                            "reasoning",
                            false,
                            "thinking",
                            nil
                        )
                    )
                }
                Console.WriteLine(Check.Map("models", models).ToJsonString())
                return 0
            }
            Check.That(Array.IndexOf(args, "--mode") >= 0, "Tokate used an undocumented OMP interface")
            let prompt = Console.In.ReadToEnd()
            Check.Contains(prompt, "Acceptance criteria")
            let selector = args[Array.IndexOf(args, "--model") + 1]
            Check.That(
                args[Array.IndexOf(args, "--mode") + 1] == "json" && Array.IndexOf(args, "--no-session") >= 0 &&
                    args[Array.IndexOf(args, "--approval-mode") + 1] == "yolo",
                "Managed OMP did not run headless without a saved session"
            )
            for role in[]string{"--smol", "--slow", "--plan"} {
                Check.That(args[Array.IndexOf(args, role) + 1] == selector, "An OMP model role escaped the selection")
            }
            Check.That(
                Array.IndexOf(args, "--no-extensions") < 0 && Array.IndexOf(args, "--no-tools") < 0,
                "Managed OMP disabled donor configuration or tools"
            )
            Check.That(
                Environment.GetEnvironmentVariable("GH_TOKEN") == nil && Environment.GetEnvironmentVariable(
                    "OPENROUTER_API_KEY"
                ) == nil,
                "Managed OMP inherited host credentials"
            )
            File.WriteAllText(Path.Combine(settings, "ran"), String.Join("\n", args))
            File.WriteAllText("result.txt", "OMP fixture completed\n")
            File.WriteAllText(
                "tokate-public-summary.json",
                "{\"changes\":[\"Add a result containing the fixture completion text.\"],\"verification\":[],\"limitations\":[]}"
            )
            let split = selector.IndexOf('/')
            let message = Check.Map(
                "role",
                "assistant",
                "content",
                Check.Json("[{\"type\":\"text\",\"text\":\"OMP fixture completed.\"}]"),
                "provider",
                selector.Substring(0, split),
                "model",
                mode == "substituted" ? "other-model": selector.Substring(split + 1),
                "usage",
                Check.Map("input", 100, "output", 7, "cacheRead", 20, "cacheWrite", 5, "totalTokens", 132),
                "stopReason",
                mode == "failed" ? "error": mode == "length" ? "length": "stop"
            )
            if mode == "failed" {
                message["errorMessage"] = "402 Insufficient credits\nfor this request sk-fixture0123456789"
            }
            Console.WriteLine(Check.Map("type", "session", "version", 3, "id", "fixture").ToJsonString())
            Console.WriteLine(Check.Map("type", "agent_start").ToJsonString())
            Console.WriteLine(Check.Map("type", "message_end", "message", message).ToJsonString())
            if mode != "incomplete" {
                Console.WriteLine(Check.Map("type", "agent_end", "isTerminal", true).ToJsonString())
            }
            return mode == "failed" ? 1: 0
        }
    }
}
