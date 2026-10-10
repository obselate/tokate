#!/usr/bin/env python3
import argparse
import contextlib
import http.server
import json
import os
from pathlib import Path
import shlex
import signal
import subprocess
import sys
import tempfile
import threading
import time

parser = argparse.ArgumentParser(description='Real installed OMP against a synthetic server; no inference')
parser.add_argument('--omp', required=True, type=Path)
parser.add_argument('--tests', default='artifacts/tests/tokate-tests')
parser.add_argument('--binary', default='artifacts/linux-x64/tokate')
parser.add_argument('--case', action='append', dest='cases', help='Run only a named system scenario')
parser.add_argument('--inside', action='store_true', help=argparse.SUPPRESS)
args = parser.parse_args()
if not args.inside:
    command = ['/usr/bin/bwrap', '--die-with-parent', '--unshare-user', '--unshare-net',
               '--bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--', sys.executable,
               str(Path(__file__).resolve()), *sys.argv[1:], '--inside']
    sys.exit(subprocess.run(command, timeout=1800).returncode)
omp = args.omp.resolve(strict=True)
version = subprocess.check_output([str(omp), '--version'], env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': '/nonexistent'},
                                  text=True, timeout=30).strip()
assert version.startswith('omp/'), 'The real OMP executable is required; this probe never installs it'
print('OMP proof version: ' + version, flush=True)
all_cases = ['stop', 'tools', 'failed', 'timeout', 'cancel']
cases = args.cases or all_cases
if not set(cases) <= set(all_cases):
    parser.error('Unknown OMP proof case')

class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        self.errors.append(str(sys.exc_info()[1]))

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *unused):
        pass

    def do_GET(self):
        body = json.dumps({'object': 'list', 'data': [{'id': 'synthetic/model:exact'}]}).encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.server.calls += 1
        assert self.path == '/v1/chat/completions'
        assert body['model'] == 'synthetic/model:exact', 'OMP requested another model'
        assert 'reasoning_effort' not in body, 'Absent effort sent a reasoning request'
        assert self.headers.get('Authorization') is None, 'A credential reached the synthetic provider'
        names = {tool['function']['name'] for tool in body.get('tools') or []}
        assert {'bash', 'read', 'write'} <= names, 'Managed OMP disabled its native tools'
        if self.server.case == 'failed':
            error = json.dumps({'error': {'message': 'Insufficient credits', 'code': 402}}).encode()
            self.send_response(402)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(error)))
            self.end_headers()
            self.wfile.write(error)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        turn = sum(message['role'] == 'assistant' for message in body['messages'])
        code = "from pathlib import Path\nassert Path('result.txt').read_text() == 'before'\nPath('result.txt').write_text('final')"
        planned = [('bash', {'command': 'printf final > result.txt'})]
        if self.server.case == 'tools':
            planned = [('write', {'path': 'result.txt', 'content': 'before'}), ('read', {'path': 'result.txt'}),
                       ('bash', {'command': 'python3 -c ' + shlex.quote(code) + ' || echo TOOL_FAILURE'})]
        elif self.server.case == 'timeout':
            planned = [('bash', {'command': "touch running; setsid sh -c 'sleep 40; touch timeout-escaped' & sleep 40"})]
        elif self.server.case == 'cancel':
            planned = [('bash', {'command': "touch running; setsid sh -c 'sleep 40; touch cancel-escaped' & sleep 40"})]
        if turn < len(planned):
            name, parameters = planned[turn]
            delta = {'role': 'assistant', 'tool_calls': [{'index': 0, 'id': f'call_{turn}', 'type': 'function',
                     'function': {'name': name, 'arguments': json.dumps({'i': 'Synthetic proof step', **parameters})}}]}
            chunk = {'choices': [{'index': 0, 'delta': delta, 'finish_reason': 'tool_calls'}]}
        else:
            for message in body['messages']:
                if message['role'] == 'tool' and 'TOOL_FAILURE' in str(message.get('content', '')):
                    raise AssertionError('Tool check failed: ' + str(message.get('content', ''))[:2000])
            delta = {'role': 'assistant', 'content': 'Changes: synthetic edits. Verification: native tools. Limitations: no inference.'}
            chunk = {'choices': [{'index': 0, 'delta': delta, 'finish_reason': 'stop'}]}
        self.server.input_tokens += 10
        self.server.output_tokens += 5
        chunk.update(id=f'completion-{turn}', object='chat.completion.chunk', created=1, model='synthetic/model:exact',
                     usage={'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15})
        self.wfile.write(('data: ' + json.dumps(chunk) + '\n\ndata: [DONE]\n\n').encode())
        self.close_connection = True

with Server(('127.0.0.1', 0), Handler) as server:
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    for case in cases:
        with tempfile.TemporaryDirectory(prefix='tokate-omp-proof-', dir='/var/tmp') as directory:
            root = Path(directory)
            server.calls = 0
            server.input_tokens = 0
            server.output_tokens = 0
            server.case = case
            server.errors = []
            fixture_root = root / 'fixtures'
            fixture_root.mkdir()
            env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TOKATE_TEST_ROOT': str(fixture_root),
                   'TOKATE_BINARY': str(Path(args.binary).resolve())}
            command = [args.tests, '--omp-proof', str(omp), directory, f'http://127.0.0.1:{port}/v1', case]
            started = time.monotonic()
            process = subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                       start_new_session=True)
            try:
                checkout = None
                if case in ['timeout', 'cancel']:
                    deadline = time.monotonic() + 90
                    while time.monotonic() < deadline and process.poll() is None:
                        if (root / 'fixture.json').exists():
                            checkout = Path(json.loads((root / 'fixture.json').read_text())['checkout'])
                            if (checkout / 'running').exists():
                                break
                        time.sleep(0.1)
                    assert checkout and (checkout / 'running').exists(), f'{case}: OMP never started its command'
                    launched = time.monotonic()
                if case == 'cancel':
                    children = set()
                    for task in Path(f'/proc/{process.pid}/task').iterdir():
                        children.update((task / 'children').read_text().split())
                    targets = [int(pid) for pid in children if Path(f'/proc/{pid}/exe').resolve() == Path(args.binary).resolve()]
                    assert len(targets) == 1, 'Expected one owned Tokate work process'
                    descriptor = os.pidfd_open(targets[0])
                    try:
                        signal.pidfd_send_signal(descriptor, signal.SIGINT)
                    finally:
                        os.close(descriptor)
                output, error = process.communicate(timeout=240)
                if process.returncode != 0:
                    print('Protocol errors: ' + repr(server.errors), file=sys.stderr)
                    for evidence in [*root.rglob('events.jsonl'), *root.rglob('stderr.log')]:
                        print(evidence.read_text()[-6000:], file=sys.stderr)
                assert process.returncode == 0, f'{case}: {output}\n{error}'
                saved = json.loads((root / 'result.json').read_text())
                assert 'omp/' + saved['omp_version'] == version, 'OMP version evidence does not match the tested executable'
                if case in ['stop', 'tools']:
                    assert not server.errors, server.errors
                    assert saved['usage'] == {'input_tokens': server.input_tokens, 'cached_input_tokens': 0,
                                              'output_tokens': server.output_tokens}, saved['usage']
                    assert server.calls == (4 if case == 'tools' else 2), f'{case}: unexpected provider requests'
                elif case == 'failed':
                    assert 'usage' not in saved, 'A refused request reported usage'
                else:
                    assert time.monotonic() - started < 150, f'{case}: stop was not bounded'
                    while time.monotonic() - launched < 45:
                        time.sleep(0.5)
                    escaped = [path.name for path in fixture_root.rglob('*-escaped')]
                    assert not escaped, f'{case}: a harness descendant survived'
                    assert server.calls == 1, f'{case}: another provider request was scheduled'
            finally:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
                process.communicate(timeout=5)
        print('PASS native OMP proof ' + case, flush=True)
print(json.dumps({'type': 'omp.proof', 'tested_version': version, 'cases': cases}), flush=True)
