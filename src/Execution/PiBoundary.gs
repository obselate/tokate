package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class PiBoundary {
    shared {
        internal func Endpoint(value string) string {
            var uri Uri
            if !Uri.TryCreate(value, UriKind.Absolute, out uri) ||
                uri.Scheme != "http" ||
                (uri.Host != "127.0.0.1" && uri.Host != "[::1]") ||
                uri.UserInfo != "" ||
                uri.Query != "" ||
                uri.Fragment != "" ||
                uri.AbsolutePath != "/v1" {
                throw Exception(
                    "Pi requires an explicit no-auth HTTP loopback base URL ending in /v1; endpoint details remain private"
                )
            }
            return uri.AbsoluteUri
        }

        internal func ModelSettings(
            root string,
            node string,
            model string,
            endpoint string,
            budget RuntimeBudget? = nil
        ) JsonElement {
            let storage = Directory.CreateDirectory(
                Path.Combine("/tmp", "tokate-pi-model-" + Guid.NewGuid().ToString("N")),
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
            )
            try {
                let script = Path.Combine(storage.FullName, "model.mjs")
                File.WriteAllText(script, ApplicationInfo.Resource("pi-model.mjs"))
                let args = List[string]{
                    "--map-current-user",
                    "--net",
                    "--",
                    LocalPaths.NeedSystemTool("env"),
                    "-i",
                    "PATH=" + NixRuntime.SearchPath(NixRuntime.Tools("", []string{node}).ToArray()),
                    "LANG=C.UTF-8",
                    "PI_OFFLINE=1"
                }
                for key in[]string{"HOME", "PI_CODING_AGENT_DIR"} {
                    if let value = Environment.GetEnvironmentVariable(key) {
                        args.Add(key + "=" + value)
                    }
                }
                args.AddRange([]string{node, "--experimental-import-meta-resolve", script, root, model})
                let result = Commands.Run(
                    LocalPaths.NeedSystemTool("unshare"),
                    args.ToArray(),
                    storage.FullName,
                    input: endpoint,
                    seconds: 30,
                    isolated: true,
                    budget: budget
                )
                if result.Code != 0 || result.Truncated || result.ReadFailed {
                    throw Exception(
                        "Pi requires one configured local model at the selected endpoint; no inference started"
                    )
                }
                let limits = RequestData.Parse(result.Output.Trim(), 4096)
                RequestData.Keys(limits, "provider,contextWindow,maxTokens,reasoning,efforts")
                let contextWindow = J.Number(limits, "contextWindow")
                let maxTokens = J.Number(limits, "maxTokens")
                if contextWindow < 1 || maxTokens < 1 || maxTokens > contextWindow {
                    throw Exception("Pi configured model limits are invalid; no inference started")
                }
                return limits
            } finally {
                Directory.Delete(storage.FullName, true)
            }
        }

        internal func CheckEffort(settings JsonElement, effort string) {
            for level in J.Items(J.Get(settings, "efforts")) {
                if level.GetString() == effort {
                    return
                }
            }
            throw Exception(
                "Pi does not support the selected reasoning effort for this configured model; choose a supported level before starting"
            )
        }

        internal func Cli(executable string, node string) List[string] {
            let command = List[string]{"PI_CODING_AGENT_DIR=" + LocalPaths.PiDirectory()}
            if executable.EndsWith(".js") || executable.EndsWith(".mjs") || executable.EndsWith(".cjs") {
                command.Add(node)
            }
            command.Add(executable)
            return command
        }

        internal func Probe(root string, node string, budget RuntimeBudget? = nil) JsonElement {
            let packageRoot = Path.Combine(root, "@earendil-works/pi-coding-agent")
            let metadata = RequestData.FileData(Path.Combine(packageRoot, "package.json"), 128 * 1024)
            let entry = J.Text(J.Get(metadata, "bin"), "pi")
            let cli = Path.GetFullPath(Path.Combine(packageRoot, entry))
            if entry == "" || !LocalPaths.Within(cli, packageRoot) || !File.Exists(cli) {
                throw Exception("The installed Pi package does not provide its CLI entrypoint")
            }
            let version = Version(root, node, []string{cli, "--version"}, budget)
            let runtime = Version(root, node, []string{"--version"}, budget)
            if version != J.Text(metadata, "version") || !runtime.StartsWith("v") {
                throw Exception("Pi CLI or Node version differs from its installed package")
            }
            return J.Parse(J.Write(map[string, Object?]{"type": "pi.probe", "version": version, "node": runtime}))
        }

        private func Version(root string, node string, arguments[]string, budget RuntimeBudget?) string {
            let result = Commands.Run(node, arguments, root, seconds: 30, budget: budget)
            if result.Code != 0 || result.Truncated || result.ReadFailed {
                throw LinuxSandbox.ProbeFailure(result, "Pi CLI or Node readiness check failed; no inference started")
            }
            return result.Output.Trim()
        }
    }
}
