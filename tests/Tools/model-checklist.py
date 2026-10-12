import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time

binary, root = sys.argv[1:]
local_model = "local-" + "x" * 120
os.environ["TERM"] = "xterm-256color"
os.environ["NO_COLOR"] = "1"


def checkout(path):
    git = {key: value for key, value in os.environ.items() if not key.startswith("GIT_CONFIG_")}
    subprocess.run(["/usr/bin/git", "init", "-q", "-b", "main", path], check=True, env=git)
    subprocess.run(
        ["/usr/bin/git", "-C", path, "remote", "add", "origin", "https://github.com/owner/project.git"],
        check=True, env=git,
    )


def start(path, home=False):
    if not home:
        checkout(path)
    pid, fd = pty.fork()
    if pid == 0:
        if home:
            os.execv(binary, [binary])
        os.execv(binary, [
            binary, "init", "owner/project", "--path", path,
            "--model-policy", "whitelist", "--allowed-tools", "codex,pi", "--verification", '[["/usr/bin/true"]]',
            "--required-checks", '["verify"]', "--eligibility", "trusted",
            "--base-branch", "main", "--max-time", "60s",
            "--reservation-time", "300s", "--pr-text", "Owner notes",
        ])
    resize(fd, 100, 24)
    return pid, fd


def resize(fd, width, height):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", height, width, 0, 0))


def read(fd, seconds=0.3):
    data = b""
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], max(0, deadline - time.monotonic()))
        if not ready:
            break
        try:
            part = os.read(fd, 65536)
        except OSError:
            break
        if not part:
            break
        data += part
    return data


def expect(fd, needle):
    data = b""
    deadline = time.monotonic() + 15
    while needle not in data and time.monotonic() < deadline:
        data += read(fd)
    assert needle in data, (needle, data[-4000:])
    return data


def finish(pid, fd, expected):
    data = b""
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        data += read(fd)
        ended, status = os.waitpid(pid, os.WNOHANG)
        if ended:
            assert os.waitstatus_to_exitcode(status) == expected, data[-4000:]
            assert b"\x1b[?1049l" in data, "Alternate screen was not restored"
            return
    raise AssertionError("Owner setup did not finish")


for cancelled in (False, True):
    os.environ["TERM"] = "vt100" if cancelled else "xterm-256color"
    path = root + ("-cancelled" if cancelled else "")
    pid, fd = start(path)
    try:
        initial = expect(fd, b"0 selected")
        assert b"(suggested)" in initial, initial
        assert b"[Local]" in initial and b"[Subscription]" in initial, initial
        assert local_model.encode() in re.sub(rb"\x1b\[[0-?]*[ -/]*[@-~]", b"", initial), "Long model ID was cut off"
        assert b"\x1b[?25l" not in initial, "Picker changed cursor visibility"
        if cancelled:
            os.write(fd, b"\x1b")
            finish(pid, fd, 1)
            assert not os.path.exists(os.path.join(path, ".github"))
            continue
        os.write(fd, b" ")
        expect(fd, b"1 selected")
        os.write(fd, b"local ")
        expect(fd, b"2 selected")
        os.write(fd, b"\x15zznomatch")
        expect(fd, b"No matching models")
        assert read(fd, 0.4) == b"", "Idle picker kept redrawing"
        resize(fd, 20, 5)
        expect(fd, b"Enlarge terminal")
        resize(fd, 90, 20)
        restored = expect(fd, b"zznomatch")
        assert b"2 selected" in restored, restored
        os.write(fd, b"\x15locl\x1b[D")
        expect(fd, b"locl")
        resize(fd, 50, 12)
        expect(fd, b"locl")
        os.write(fd, b"a")
        expect(fd, b"local")
        os.write(fd, "\x15界".encode())
        expect(fd, "界".encode())
        os.kill(pid, signal.SIGSTOP)
        os.waitpid(pid, os.WUNTRACED)
        os.kill(pid, signal.SIGCONT)
        resumed = expect(fd, b"2 selected")
        assert "界".encode() in resumed, resumed
        assert read(fd, 0.4) == b"", "Resume caused an idle redraw loop"
        os.write(fd, b"\x1bOQ")
        expect(fd, b"Model name")
        os.write(fd, b"remote-model\nabsent\n")
        expect(fd, b"3 selected")
        os.write(fd, b"\r")
        expect(fd, b"Review project setup")
        resize(fd, 80, 24)
        expect(fd, b"Review project setup")
        os.write(fd, b"\x1b[B\r")
        expect(fd, b"Change project setup")
        os.write(fd, b"\x1b[B" * 4 + b"\r")
        reservation = expect(fd, b"Reservation time [5m]: ")
        assert reservation.count(b"Reservation time [5m]: ") == 1, reservation
        assert b"Value: " not in reservation, reservation
        os.write(fd, b"10m\r")
        expect(fd, b"Review project setup")
        os.write(fd, b"\r")
        finish(pid, fd, 0)
        with open(os.path.join(path, ".github", "tokate.json")) as file:
            policy = json.load(file)
        assert policy["reservation_seconds"] == 600, policy["reservation_seconds"]
        models = policy["models"]
        assert models == {
            "gpt-6.1-sol": ["high"], local_model: ["absent"], "remote-model": ["absent"],
        }, models
        assert policy["allowed_tools"] == [
            {"harness": "codex", "provider": "openai"},
            {"harness": "pi", "provider": "local-chat-completions"},
        ], policy["allowed_tools"]
    finally:
        try:
            ended, _ = os.waitpid(pid, os.WNOHANG)
            if not ended:
                os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
        except (ChildProcessError, ProcessLookupError):
            pass
        os.close(fd)

pid, fd = start(root, home=True)
try:
    welcome = expect(fd, b"Give your inference a purpose.")
    assert b"Donate AI time" in welcome and b"Continue existing work" in welcome, welcome
    assert b"> Donate AI time" in welcome and b"Arrows move; Enter selects" in welcome, welcome
    os.write(fd, b"x")
    changed = expect(fd, b"Search: x")
    assert b"\x1b[2J" not in changed and b"\x1b[?25" not in changed, changed
    assert read(fd, 0.4) == b"", "Welcome kept redrawing while idle"
    resize(fd, 20, 5)
    expect(fd, b"Enlarge terminal")
    resize(fd, 80, 24)
    expect(fd, b"Search: x")
    os.write(fd, b"\x15\x1b[B")
    expect(fd, b"> Set up my project")
    os.write(fd, b"\x1b[A")
    expect(fd, b"> Donate AI time")
    resize(fd, 40, 24)
    expect(fd, b"> Donate AI time")
    os.write(fd, b"?")
    explained = expect(fd, b"fills in details it can find.")
    assert b"Choose the job you want to do. Tokate\x1b[7;1H" in explained, explained
    resize(fd, 80, 24)
    expect(fd, b"> Donate AI time")
    os.write(fd, b"\r")
    transition = expect(fd, b"Project")
    assert b"Loading next step..." in transition, transition
    assert b"\x1b[H\x1b[2JLoading next step...\x1b[K\r\n" in transition, "Wizard progress did not clear the menu and end its line"
    assert b"\x1b[?1049l" not in transition and b"\x1b[?1049h" not in transition, "Wizard disappeared between steps"
    os.write(fd, b"https://github.com/owner/project/issues/0\r")
    expect(fd, b"Invalid positive number")
    os.write(fd, b"h\r")
    expect(fd, b"Donate AI time")
    os.write(fd, b"h")
    expect(fd, b"Donate AI time")
    os.write(fd, b"q")
    finish(pid, fd, 0)
finally:
    try:
        ended, _ = os.waitpid(pid, os.WNOHANG)
        if not ended:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
    except (ChildProcessError, ProcessLookupError):
        pass
    os.close(fd)

print("PASS accepted welcome: incremental paint, resize, retained input, invalid repository, home and quit")

print("PASS owner model checklist: selection, filtering, resize, resume, cancellation and no idle redraw")
