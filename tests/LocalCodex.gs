package TokateTests

import System
import System.Collections.Generic
import System.IO
import System.Security.Cryptography
import System.Text.Json.Nodes

internal class LocalCodex {
    shared {
        internal func Managed(binary string, native string, directory string, endpoint string) {
            using let flow = NativeFlow(binary)
            flow.Initialize()
            flow.Approve()
            File.Delete(Path.Combine(flow.Bin, "codex"))
            File.CreateSymbolicLink(Path.Combine(flow.Bin, "codex"), native)
            let profile = flow.Temp.Env["CODEX_HOME"]
            File.Copy(Path.Combine(directory, "auth.json"), Path.Combine(profile, "auth.json"))
            var config = "openai_base_url = " + JsonValue.Create(endpoint).ToJsonString() +
                "\nchatgpt_base_url = " +
                JsonValue
                .Create(endpoint).ToJsonString() + "\n"
            File.WriteAllText(Path.Combine(profile, "config.toml"), config)
            let run = flow.Claim(seconds: "90", reserve: "30")
            let checkout = Path.Combine(run, "checkout")
            let outside = Path.Combine(flow.Temp.Root, "outside-secret")
            File.WriteAllText(outside, "synthetic-private-value")
            let mcp = Path.Combine(profile, "mcp.py")
            File.Copy(Path.Combine(directory, "mcp.py"), mcp)
            config += "\n[mcp_servers.fixture]\ncommand = \"/usr/bin/python3\"\nargs = [" + JsonValue.Create(mcp)
                .ToJsonString() + ", " + JsonValue.Create(checkout).ToJsonString() + ", " + JsonValue.Create(outside)
                .ToJsonString() + "]\n"
            config += "default_tools_approval_mode = \"approve\"\n"
            File.WriteAllText(Path.Combine(profile, "config.toml"), config)
            Check.SaveJson(Path.Combine(directory, "fixture.json"), Check.Map("checkout", checkout, "run", run))
            let result = TestProcess.Run(binary, []string{"work", "--run", run, "--yes"}, flow.Temp.Env)
            File.WriteAllText(Path.Combine(directory, "result.txt"), result.Output + result.Error)
            for name in[]string{"events.jsonl", "stderr.log", "run.json"} {
                if File.Exists(Path.Combine(run, name)) {
                    File.Copy(Path.Combine(run, name), Path.Combine(directory, name))
                }
            }
            Check.Success(result)
            Check.That(
                File.ReadAllText(Path.Combine(checkout, "custom.txt")) == "configured tool worked",
                "Configured Codex MCP did not run"
            )
            Check.That(!File.Exists(Path.Combine(checkout, ".git/private-marker")), "Private Git metadata escaped")
            Check.That(File.ReadAllText(outside) == "synthetic-private-value", "Codex changed outside data")
            flow.Publish(run)
            flow.Call([]string{"verify-pr", "--repo", "owner/project", "--pr", "10"}, owner: true)
            Console.WriteLine("PASS native Codex configured MCP, sandbox, verification and draft submission")
        }

        internal func All(binary string, launcher string, native string, standalone string) {
            using let flow = NativeFlow(binary)
            flow.Initialize()
            guard let node = Environment.GetEnvironmentVariable("TOKATE_PROOF_NODE") else {
                throw Exception("Missing donor-local Node for installation proof")
            }
            guard let version = Environment.GetEnvironmentVariable("TOKATE_PROOF_VERSION") else {
                throw Exception("Missing installed Codex version for installation proof")
            }
            Check.Success(
                TestProcess.Run(
                    "/bin/sh",
                    []string{
                        "-c",
                        "PATH=/usr/local/bin:/usr/bin:/bin; if command -v node; then exit 1; fi; \"$1\" --version",
                        "proof",
                        node
                    },
                    flow.Temp.Env
                )
            )
            File.CreateSymbolicLink(Path.Combine(flow.Bin, "node"), node)
            Check.Contains(Check.Success(TestProcess.Run(launcher, []string{"--version"}, flow.Temp.Env)), version)
            let secrets = List[string]()
            for relative in[]string{
                ".netrc",
                ".aws/credentials",
                ".config/gh/hosts.yml",
                ".cache/npm/token",
                ".codex/config.toml"
            } {
                let secret = Path.Combine(flow.Temp.Env["HOME"], relative)
                Directory.CreateDirectory(Path.GetDirectoryName(secret) ?? "")
                File.WriteAllText(secret, "synthetic-local-install-secret")
                secrets.Add(secret)
            }
            let auth = Path.Combine(flow.Temp.Env["CODEX_HOME"], "auth.json")
            File.WriteAllText(auth, "synthetic-local-install-secret")
            secrets.Add(auth)
            let packageSecret = Path.Combine(Path.GetDirectoryName(native) ?? "", "private-config")
            File.WriteAllText(packageSecret, "synthetic-local-install-secret")
            secrets.Add(packageSecret)
            secrets.Add(launcher)
            secrets.Add(node)
            let checkout = Path.Combine(flow.Temp.Root, "isolation-checkout")
            Directory.CreateDirectory(Path.Combine(checkout, ".git"))
            File.WriteAllText(Path.Combine(checkout, ".git/config"), "synthetic-git-secret")
            for selected in[]string{launcher, standalone} {
                File.Delete(Path.Combine(flow.Bin, "codex"))
                File.CreateSymbolicLink(Path.Combine(flow.Bin, "codex"), selected)
                let doctor = Check.Envelope(flow.Call([]string{"doctor", "--managed", "--json"}), "doctor", "ok")
                Check.That(doctor["data"]?["tools"] != nil, "Doctor did not report capabilities")
                let choice = Check.Envelope(
                    flow.Call(
                        []string{
                            "select",
                            "--repo",
                            "owner/project",
                            "--model",
                            "gpt-6.1-sol",
                            "--effort",
                            "high",
                            "--non-interactive",
                            "--json"
                        }
                    ),
                    "select",
                    "ok"
                )
                Check.That(
                    Check.Text(choice["data"]?["model"]) == "gpt-6.1-sol",
                    "Production offline selection did not retain the requested model"
                )
            }
            for runtime in[]string{native, standalone} {
                let digest = SHA256.HashData(File.ReadAllBytes(runtime))
                let filesystem = "{ \":root\" = \"deny\", \":minimal\" = \"read\", \"/tmp\" = \"write\", " +
                    JsonValue
                    .Create(checkout).ToJsonString() + " = \"write\", " + JsonValue.Create(
                    Path.Combine(checkout, ".git")
                )
                    .ToJsonString() + " = \"deny\", " + JsonValue.Create(runtime).ToJsonString() + " = \"read\" }"
                let args = List[string]{
                    "sandbox",
                    "-P",
                    "tokate",
                    "--include-managed-config",
                    "-C",
                    checkout,
                    "-c",
                    "permissions.tokate.filesystem=" + filesystem,
                    "-c",
                    "permissions.tokate.network.enabled=false",
                    "--",
                    "/usr/bin/env",
                    "-i",
                    "PATH=/usr/local/bin:/usr/bin:/bin",
                    "HOME=/tmp/tokate-home",
                    "CODEX_HOME=/tmp/tokate-home",
                    "/bin/sh",
                    "-c",
                    "set -eu; runtime=$1; shift; test -r \"$$runtime\"; test ! -w \"$$runtime\"; \"$$runtime\" --version; test ! -r .git/config; for secret do test ! -r \"$$secret\"; done; touch isolation-writable; touch /tmp/isolation-writable",
                    "proof",
                    runtime
                }
                args.AddRange(secrets)
                args.Add(runtime == native ? standalone: native)
                Check.Contains(Check.Success(TestProcess.Run(runtime, args.ToArray(), flow.Temp.Env)), version)
                Check.That(
                    Convert.ToHexString(digest) == Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(runtime))),
                    "Installed runtime changed"
                )
            }
            using let independent = CoordinationFixture(binary)
            independent.Initialize(approve: false)
            independent.Flow.VerificationPolicy(
                "set -eu; test -r .git/config; touch independent-writable; printf independent-verification-ran"
            )
            independent.Flow.Approve()
            let request = independent.Claim()
            let run = independent.Prepare()
            let head = independent.Candidate(request)
            independent.Flow.Call([]string{"external", "--run", run, "--commit", head})
            Check.Contains(File.ReadAllText(Path.Combine(run, "verification.json")), "independent-verification-ran")
            independent.Flow.NoInference()
            let unsupported = Path.Combine(flow.Bin, "unsupported-launcher")
            let marker = Path.Combine(flow.Temp.Root, "launcher-discovery-ran")
            File.WriteAllText(
                unsupported,
                "#!/bin/sh\nif test \"$1\" = --version; then echo codex-cli 0.160.0; exit 0; fi\ntouch '" +
                    marker +
                    "'\nexit 1\n"
            )
            File.SetUnixFileMode(unsupported, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute)
            File.Delete(Path.Combine(flow.Bin, "codex"))
            File.CreateSymbolicLink(Path.Combine(flow.Bin, "codex"), unsupported)
            let refusal = TestProcess.Run(binary, []string{"doctor", "--managed", "--json"}, flow.Temp.Env)
            Check.That(refusal.Code != 0, "Unsupported runtime was accepted")
            Check.Envelope(refusal, "doctor", "error", "verification_failed")
            Check.Contains(refusal.Output, "Unsupported managed Codex runtime layout")
            Check.That(!File.Exists(marker), "An arbitrary launcher was executed to discover runtime files")
            Check.That(File.ReadAllText(auth) == "synthetic-local-install-secret", "Harness authentication was changed")
            flow.NoInference()
            Console.WriteLine(
                "PASS production doctor and offline selection: unmodified npm launcher and native symlink with donor-local Node, system Node unavailable; runtime read-only; synthetic home/auth/cache/package/Git secrets unreadable; independent verification runs in a writable copy; unsupported launchers diagnosed without discovery execution; no inference"
            )
        }
    }
}
