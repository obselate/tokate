package TokateDesktop

import System
import System.Collections.Generic
import System.IO
import System.Text.Json
import System.Text.Json.Nodes

class Regression {
    shared {
        var Failures int32
        var Checks int32

        func Check(condition bool, name string) {
            Checks++
            if !condition {
                Failures++
                Console.Error.WriteLine("FAIL: " + name)
            }
        }

        func Equal(actual string, expected string, name string) {
            Check(actual == expected, name + " (expected '" + expected + "', got '" + actual + "')")
        }

        func Throws(action Action, message string, name string) {
            try {
                action()
                Check(false, name + " (no exception)")
            } catch (error Exception) {
                Equal(error.Message, message, name)
            }
        }

        func Fixture(name string) JsonElement -> Json.ParseFile(Path.Combine(AppContext.BaseDirectory, "Fixtures", name))

        func Args(values []string) string -> String.Join(" ", values)
    }
}

func Main() int32 {
    ModelTests()
    CodecTests()
    CommandTests()
    ServiceTests()
    ShellTests()
    OwnerTests()
    DonationTests()
    SavedTests()
    ArchitectureTests()
    if Regression.Failures > 0 {
        Console.Error.WriteLine(Regression.Failures.ToString() + " of " + Regression.Checks.ToString() + " checks failed")
        return 1
    }
    Console.WriteLine("PASS: " + Regression.Checks.ToString() + " regression checks")
    return 0
}
