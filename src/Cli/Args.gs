package Tokate

import System
import System.Collections.Generic
import System.Text.Json
import System.Text.RegularExpressions

internal class Args {
    internal let Values Dictionary[string, string] = Dictionary[string, string]()
    internal let Words List[string] = List[string]()
    internal var Command string = "help"
    internal var Help bool = false
    internal var Subject string = ""
    internal var Run string = ""
    internal var Attempts List[SavedRun] = List[SavedRun]()
    internal var Guided bool
    internal var SavedDefaults JsonElement
    internal var HarnessFromDefault bool
    internal init(args[]string) {
        var i int32 = 0
        while i < args.Length && Cli.Global(args[i]) {
            if Values.ContainsKey(args[i]) {
                throw Exception("Duplicate option: " + args[i])
            }
            Values.Add(args[i], "true")
            i++
        }
        if i == args.Length {
            Help = true
            return
        }
        Command = args[i] == "--help" || args[i] == "-h" ? "help": args[i] == "version" ? "--version": args[i]
        Cli.Find(Command)
        i++
        while i < args.Length {
            let word = args[i]
            if Command == "help" && word == "--version" && Words.Count == 0 {
                Words.Add(word)
                i++
                continue
            }
            if !word.StartsWith("-") {
                Words.Add(word)
                i++
                continue
            }
            let equal = word.IndexOf('=')
            let key = word == "-h" ? "--help": (equal < 0 ? word: word.Substring(0, equal))
            if !key.StartsWith("--") {
                throw Exception("Unknown option for " + Command + ": " + key)
            }
            if Values.ContainsKey(key) {
                throw Exception("Duplicate option: " + key)
            }
            let option = Cli.OptionFor(Command, key.Substring(2))
            if option.Value == "" {
                if equal >= 0 {
                    throw Exception("Flag does not take a value: " + key)
                }
                Values.Add(key, "true")
            } else {
                var value = equal < 0 ? "": word.Substring(equal + 1)
                if equal < 0 {
                    i++
                    if i < args.Length && !args[i].StartsWith("-") {
                        value = args[i]
                    }
                }
                if String.IsNullOrWhiteSpace(value) {
                    throw Exception("Missing value for " + key)
                }
                if option.Value == "TIME" {
                    Values.Add("--" + Cli.TimeKey(option.Name), Cli.Seconds(value, option.Name))
                } else {
                    Values.Add(key, value)
                }
            }
            i++
        }
        Help = Command == "help" || Get("help") == "true"
        Positionals.Bind(this)
    }

    internal func Get(key string, fallback string = "") string {
        var value string
        return Values.TryGetValue("--" + key, out value) ? value: fallback
    }

    internal func Need(key string) string {
        let value = Get(key)
        if value == "" {
            throw Exception("Required: " + Cli.Label(key))
        }
        return value
    }

    internal func Number(key string, fallback string = "") int32 {
        let value = Get(key, fallback)
        var number int32
        if (key == "verification-reserve" && !Regex.IsMatch(value, "^[0-9]+\\z")) || !Int32.TryParse(
            value,
            out number
        ) ||
            number < 1 {
            throw Exception("Invalid positive number: " + Cli.Label(key))
        }
        if (key == "seconds" || key == "timeout") && number > 86400 {
            throw Exception("Use at most 24h: " + Cli.Label(key))
        }
        return number
    }
}
