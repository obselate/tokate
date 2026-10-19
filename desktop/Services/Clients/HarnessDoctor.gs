package TokateDesktop

import System
import System.Collections.Generic

/// Asks Tokate which harnesses are not set up on this computer. Calls block, so run them from a `go` worker.
class HarnessDoctor {
    shared {
        /// The result of the last check, to show before the next check ends.
        var Known []string = []string{}

        func Unready() []string {
            let unready = List[string]()
            for option in HarnessOption.All {
                let id = option.Id
                if id == "command" {
                    continue
                }
                let reply = CliClient().Run[bool](TokateCommands.HarnessDoctor(id), data -> DonorCodec.HarnessReady(data, id), 60)
                if reply.Outcome.Failure == "" && !reply.Value {
                    unready.Add(id)
                }
            }
            Known = unready.ToArray()
            return Known
        }
    }
}
