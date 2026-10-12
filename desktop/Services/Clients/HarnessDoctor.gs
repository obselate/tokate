package TokateDesktop

import System
import System.Collections.Generic

/// Asks Tokate which harnesses are not set up on this computer. Calls block, so run them from a `go` worker.
class HarnessDoctor {
    shared {
        func Unready() []string {
            let unready = List[string]()
            for option in HarnessOption.All {
                let id = option.Id
                let reply = CliClient().Run[bool](TokateCommands.HarnessDoctor(id), data -> DonorCodec.HarnessReady(data, id), 30)
                if reply.Outcome.Failure == "" && !reply.Value {
                    unready.Add(id)
                }
            }
            return unready.ToArray()
        }
    }
}
