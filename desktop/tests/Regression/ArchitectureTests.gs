package TokateDesktop

import System
import System.Collections.Generic
import System.IO
import System.Text.RegularExpressions

func DesktopRoot() string {
    var directory DirectoryInfo? = DirectoryInfo(AppContext.BaseDirectory)
    while let current = directory {
        if File.Exists(Path.Combine(current.FullName, "TokateDesktop.gsproj")) {
            return current.FullName
        }
        directory = current.Parent
    }
    throw Exception("Could not find the desktop project root.")
}

func Sources(root string, folder string) []string {
    let path = Path.Combine(root, folder)
    if !Directory.Exists(path) {
        return []string{}
    }
    let result = List[string]()
    for file in Directory.EnumerateFiles(path, "*.gs", SearchOption.AllDirectories) {
        let relative = Path.GetRelativePath(root, file).Replace('\\', '/')
        if !relative.Contains("/obj/") && !relative.Contains("/bin/") {
            result.Add(file)
        }
    }
    return result.ToArray()
}

func Relative(root string, file string) string -> Path.GetRelativePath(root, file).Replace('\\', '/')

func ArchitectureTests() {
    let root = DesktopRoot()
    for file in Sources(root, "Views") {
        let text = File.ReadAllText(file)
        // Array literals such as `[]Container{...}` hold component results and are allowed.
        let primitive = Regex.Match(text, "(?<!\\[\\])\\b(Container|Text|Button|Image)\\s*\\{")
        Regression.Check(!primitive.Success, "views use components only: " + Relative(root, file))
    }

    let modelTypes = List[string]()
    for file in Sources(root, "Models") {
        let text = File.ReadAllText(file)
        Regression.Check(!text.Contains("import Goo"), "models do not import Goo: " + Relative(root, file))
        for match in Regex.Matches(text, "(?:data struct|struct|class|enum)\\s+([A-Z][A-Za-z0-9]*)") {
            modelTypes.Add(match.Groups[1].Value)
        }
    }
    let modelPattern = "\\b(" + String.Join("|", modelTypes) + "|[A-Za-z]+Service)\\b"
    for folder in []string{"Layout", "Text", "Inputs", "Feedback", "Navigation", "Art"} {
        for file in Sources(root, "Components/" + folder) {
            let found = Regex.Match(File.ReadAllText(file), modelPattern)
            Regression.Check(
                !found.Success,
                "generic components avoid models and services: " + Relative(root, file) + " uses " + found.Value
            )
        }
    }

    for folder in []string{"Models", "Services", "Components", "Views"} {
        for file in Sources(root, folder) {
            let relative = Relative(root, file)
            if relative == "Services/Json.gs" || relative.StartsWith("Services/Codecs/") || relative.StartsWith("Services/Clients/") {
                continue
            }
            Regression.Check(!File.ReadAllText(file).Contains("JsonElement"), "only codecs read JSON: " + relative)
        }
    }

    for folder in []string{"Services/Features", "Services/Codecs", "Services/Clients"} {
        for file in Sources(root, folder) {
            Regression.Check(!File.ReadAllText(file).Contains("import Goo"), "feature services avoid Goo: " + Relative(root, file))
        }
    }

    for folder in []string{"App", "Controls", "Screens"} {
        Regression.Check(!Directory.Exists(Path.Combine(root, folder)), "the legacy " + folder + " folder is gone")
    }
}
