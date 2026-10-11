package TokateDesktop

import System
import System.Collections.Generic
import System.IO

func Script(directory string, name string, body string) string {
    let path = Path.Combine(directory, name)
    File.WriteAllText(path, "#!/bin/sh\n" + body + "\n")
    File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute)
    return path
}

func ServiceTests() {
    let directory = Path.Combine(Path.GetTempPath(), "tokate-regression-" + Guid.NewGuid().ToString("N"))
    Directory.CreateDirectory(directory)
    try {
        let ok = Script(
            directory,
            "ok",
            "printf '{\"schema_version\":1,\"command\":\"%s\",\"status\":\"ok\",\"exit_code\":0,\"data\":{\"run\":\"/runs/a\",\"issue\":7}}' \"$1\""
        )
        let reply = CliClient(ok).Run[string](TokateCommands.Status("/runs/a"), data -> Json.Text(data, "issue"))
        Regression.Check(reply.Outcome.Succeeded, "CLI reply succeeds: " + reply.Outcome.Failure)
        Regression.Equal(reply.Value, "7", "CLI data is decoded")
        Regression.Equal(reply.Outcome.RunPath, "/runs/a", "CLI run path")

        let wrong = Script(
            directory,
            "wrong",
            "printf '{\"schema_version\":1,\"command\":\"other\",\"status\":\"ok\",\"exit_code\":0}'"
        )
        let mismatch = CliClient(wrong).Run(TokateCommands.Status("/runs/a"))
        Regression.Equal(
            mismatch.Failure,
            "The CLI returned an unsupported result. Inspect state before repeating this action.",
            "envelope must match the command"
        )

        let failing = Script(
            directory,
            "failing",
            "echo 'first problem' >&2; printf '{\"schema_version\":1,\"command\":\"%s\",\"status\":\"error\",\"exit_code\":1,\"error\":{\"code\":\"x\",\"message\":\"\"}}' \"$1\"; exit 1"
        )
        let failed = CliClient(failing).Run(TokateCommands.Status("/runs/a"))
        Regression.Check(failed.Failure == "" && failed.ExitCode == 1 && !failed.Succeeded, "failed command keeps its envelope")
        Regression.Equal(failed.ErrorMessage(), "first problem", "failed command falls back to diagnostics")

        let missing = CliClient(Path.Combine(directory, "absent")).Run(TokateCommands.Status("/runs/a"))
        Regression.Check(missing.Failure != "", "missing executable is reported")

        let gh = Script(directory, "gh", "printf '{\"login\":\"octo\"}'")
        let user = GitHubClient(gh).Run[string](GitHubCommands.User(), GitHubCodec.Login)
        Regression.Equal(user.Value, "octo", "GitHub result is decoded")

        let lines = chan[string](16)
        let runner = ProcessRunner(lines)
        let noisy = runner.Run(CommandStart("/bin/sh", []string{"-c", "printf 'one\\ntwo\\r\\nthree' >&2"}))
        Regression.Check(noisy.Error == "", "noisy command runs")
        let received = List[string]()
        while lines.Reader.TryRead(out var line) {
            received.Add(line)
        }
        Regression.Equal(String.Join("|", received), "one|two|three", "diagnostics lines are delivered")

        let state = Path.Combine(directory, "state")
        let runs = Path.Combine(state, "tokate/runs")
        Directory.CreateDirectory(Path.Combine(runs, "b"))
        Directory.CreateDirectory(Path.Combine(runs, "a"))
        Directory.CreateSymbolicLink(Path.Combine(runs, "c"), Path.Combine(runs, "a"))
        let previous = Environment.GetEnvironmentVariable("XDG_STATE_HOME")
        Environment.SetEnvironmentVariable("XDG_STATE_HOME", state)
        try {
            let found = RunStore.Discover("/remembered")
            Regression.Check(
                found.Length >= 3 &&
                    found[0] == "/remembered" &&
                    found[1] == Path.Combine(runs, "a") &&
                    found[2] == Path.Combine(runs, "b") &&
                    Array.IndexOf(found, Path.Combine(runs, "c")) < 0,
                "run discovery orders runs and skips links"
            )
        } finally {
            Environment.SetEnvironmentVariable("XDG_STATE_HOME", previous)
        }
        File.WriteAllText(RunStore.ClaimFile(Path.Combine(runs, "a")), File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "run-file.json")))
        Regression.Equal(
            RunStore.ClaimId(Path.Combine(runs, "a")),
            RunCodec.ClaimId(Regression.Fixture("run-file.json")),
            "claim identity from a run directory"
        )

        let checkout = Path.Combine(directory, "checkout")
        Directory.CreateDirectory(checkout)
        let git = Script(
            directory,
            "git-commits",
            "cd \"$1\" && git init -q && git config user.name t && git config user.email t@t && git config commit.gpgsign false && " +
                "git commit -q --allow-empty -m published && git rev-parse HEAD && " +
                "git commit -q --allow-empty -m empty && echo x > file && git add file"
        )
        let published = ProcessRunner().Run(CommandStart(git, []string{checkout}), 10).Output.Trim()
        Regression.Equal(RunStore.Correction(checkout, published).Commit, "", "a commit without file changes is not a correction")
        ProcessRunner().Run(CommandStart("git", []string{"-C", checkout, "commit", "-q", "-m", "Correct the work"}), 10)
        Regression.Equal(RunStore.Correction(checkout, published).Subject, "Correct the work", "a commit with file changes is a correction")
    } finally {
        Directory.Delete(directory, true)
    }
}
