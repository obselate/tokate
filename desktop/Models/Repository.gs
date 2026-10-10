package TokateDesktop

import System

data struct RepositoryRef {
    var Owner string
    var Name string
    var RequestedIssue string

    prop FullName string -> Owner + "/" + Name

    func IssueNumber() int32 {
        if RequestedIssue == "" {
            return 0
        }
        if !int32.TryParse(RequestedIssue, out var number) || number <= 0 {
            throw Exception("Enter a valid GitHub issue number.")
        }
        return number
    }

    shared {
        func Parse(value string) RepositoryRef {
            let trimmed = value.Trim().TrimEnd('/')
            let repo = trimmed.StartsWith("https://github.com/", StringComparison.OrdinalIgnoreCase) ? trimmed.Substring(
                19
            ): trimmed
            let parts = repo.Split('/')
            if parts.Length != 2 && !(parts.Length == 4 && parts[2] == "issues") {
                throw Exception("Enter owner/repository or a GitHub issue URL.")
            }
            for part in[]string{parts[0], parts[1]} {
                if part.Length == 0 || part.StartsWith("-") || part == "." || part == ".." {
                    throw Exception("Enter a valid GitHub repository.")
                }
                for c in part {
                    if !Char.IsAsciiLetterOrDigit(c) && c != '-' && c != '_' && c != '.' {
                        throw Exception("Enter a valid GitHub repository.")
                    }
                }
            }
            let raw = value.Trim().TrimEnd('/').Split('/')
            let requested = raw.Length > 2 && raw[raw.Length - 2] == "issues" ? raw[raw.Length - 1]: ""
            return RepositoryRef{Owner: parts[0], Name: parts[1], RequestedIssue: requested}
        }
    }
}
