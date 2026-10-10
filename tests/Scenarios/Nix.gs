package TokateTests

import System
import System.IO
import System.Net
import System.Net.Sockets
import System.Text.Json.Nodes

internal class NixChecks {
    shared {
        internal func Run(binary string, probe string) {
            Check.That(probe.StartsWith("/nix/store/") && File.Exists(probe), "Missing real Nix probe")
            let listener = TcpListener(IPAddress.Loopback, 0)
            listener.Start()
            try {
                let port = (listener.LocalEndpoint as IPEndPoint)?.Port.ToString() ?? throw Exception("Missing port")
                using let flow = NativeFixture(binary)
                flow.Initialize()
                let policyPath = Path.Combine(flow.Upstream, ".github/tokate.json")
                let policy = Check.Json(File.ReadAllText(policyPath))
                let command = JsonArray()
                for word in[]string{probe, port} {
                    command.Add(JsonValue.Create(word) as JsonNode)
                }
                let commands = JsonArray()
                commands.Add(command as JsonNode)
                policy["verification"] = commands
                File.WriteAllText(policyPath, policy.ToJsonString())
                flow.Commit("Select Nix verification runtime")
                flow.Git("-C", Path.Combine(flow.Bin, "fork"), "fetch", flow.Upstream, "main")
                flow.Approve()
                let run = flow.Claim()
                flow.Call([]string{"work", "--run", run})
                Check.Contains(File.ReadAllText(Path.Combine(run, "verification.json")), "nix-closure-verified")
                Check.That(listener.Pending(), "Nix verification had no network access")
                using let client = listener.AcceptTcpClient()
                flow.NoPr()
            } finally {
                listener.Stop()
            }
            Console.WriteLine("PASS selected Nix verification command runs with network access")
        }
    }
}
