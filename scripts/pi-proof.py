#!/usr/bin/env python3
import argparse
import contextlib
import http.server
import json
import os
from pathlib import Path
import signal
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time

def shard(value):
    try:
        index, count = map(int, value.split('/'))
        if 0 <= index < count:
            return index, count
    except ValueError:
        pass
    raise argparse.ArgumentTypeError('Use a zero-based INDEX/COUNT shard')

parser = argparse.ArgumentParser(description='Real installed pi against a synthetic server; no inference')
parser.add_argument('--pi-root', required=True, type=Path)
parser.add_argument('--node', default=shutil.which('node'))
parser.add_argument('--tests', default='artifacts/tests/tokate-tests')
parser.add_argument('--binary', default='artifacts/linux-x64/tokate')
parser.add_argument('--catalog-only', action='store_true')
parser.add_argument('--case', action='append', dest='cases', help='Run only a named system scenario')
parser.add_argument('--shard', type=shard, help='Run one zero-based INDEX/COUNT subset')
parser.add_argument('--inside', action='store_true', help=argparse.SUPPRESS)
args = parser.parse_args()
if not args.inside:
    command = ['/usr/bin/bwrap', '--die-with-parent', '--unshare-user', '--unshare-net',
               '--bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--', sys.executable,
               str(Path(__file__).resolve()), *sys.argv[1:], '--inside']
    sys.exit(subprocess.run(command, timeout=7200).returncode)
if not args.node:
    parser.error('Node is not on PATH; supply --node with the installed executable')
args.node = str(Path(args.node).resolve(strict=True))
package = args.pi_root / '@earendil-works/pi-coding-agent/package.json'
if not package.is_file():
    parser.error('Real pi installation is required; this probe never installs packages')
metadata = json.loads(package.read_text())
if metadata.get('name') != '@earendil-works/pi-coding-agent' or not metadata.get('version'):
    parser.error('The real pi SDK package is required')
node_version = subprocess.check_output([args.node, '--version'], env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}, text=True, timeout=10).strip()
print('Pi proof versions: ' + metadata['version'] + ', Node ' + node_version, flush=True)
length_cases = ['incomplete', 'truncated-tool']
catalog_metadata_cases = ['catalog-metadata', 'catalog-metadata-length', 'catalog-metadata-aliases']
catalog_context_failures = {
    'catalog-context-conflict': {'context_window': 7, 'context_length': 8},
    'catalog-invalid-context-window': {'context_window': '7', 'context_length': 7},
    'catalog-invalid-context-length': {'context_length': '7'},
    'catalog-context-length-string': {'context_window': 7, 'context_length': '7'},
    'catalog-context-length-boolean': {'context_window': 7, 'context_length': True},
    'catalog-context-length-zero': {'context_window': 7, 'context_length': 0},
    'catalog-context-length-negative': {'context_window': 7, 'context_length': -7},
    'catalog-context-length-fractional': {'context_window': 7, 'context_length': 7.5},
    'catalog-context-length-overflow': {'context_window': 7, 'context_length': 2147483648},
}
catalog_cases = ['catalog-missing', 'catalog-substituted', 'catalog-malformed', 'catalog-duplicate', 'catalog-duplicate-id',
                 'catalog-invalid-id', 'catalog-whitespace-id', 'catalog-invalid-metadata', 'catalog-oversized', 'catalog-chunked',
                 'catalog-redirect', 'catalog-unreachable', 'catalog-deadline', *catalog_metadata_cases, *catalog_context_failures,
                 'catalog-recheck-substituted', 'catalog-recheck-unreachable', 'catalog-recheck-malformed',
                 'catalog-recheck-context-conflict', 'catalog-recheck-invalid-context-length']
all_cases = ['reasoning', 'reasoning-off', 'profile', 'on', 'unlimited', 'unlimited-cancel', 'compact', 'compact-failed', 'failed', 'malformed',
             *length_cases, 'empty', 'cancel', *catalog_cases]
cases = args.cases or (catalog_cases if args.catalog_only else all_cases)
if not set(cases) <= set(all_cases):
    parser.error('Unknown Pi proof case')
if args.shard:
    index, count = args.shard
    if count > len(cases):
        parser.error('Shard count exceeds the selected cases')
    cases = cases[index::count]
partial_text = 'PRIVATE_PARTIAL_LENGTH_SENTINEL ' + 'é' * 35000 + ' RETAINED_LENGTH_CONTEXT_SENTINEL'
thinking_text = 'PRIVATE_THINKING_CONTENT_SENTINEL'

def message_text(message):
    content = message.get('content') or ''
    return content if isinstance(content, str) else ''.join(block.get('text', '') for block in content if block.get('type') == 'text')

class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        self.errors.append(str(sys.exc_info()[1]))

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *unused):
        pass

    def do_GET(self):
        if self.path != '/v1/models':
            assert self.path == '/', 'Metadata followed a redirect or scanned another path'
            self.send_response(204)
            self.end_headers()
            return
        self.server.catalog_calls += 1
        assert self.headers.get('Authorization') is None, 'Metadata sent authentication'
        case = self.server.case
        if case.startswith('catalog-recheck-'):
            case = case.replace('catalog-recheck-', 'catalog-') if self.server.catalog_calls == 2 else ''
        if case == 'catalog-unreachable':
            self.close_connection = True
            self.connection.close()
            return
        if case == 'catalog-redirect':
            self.send_response(302)
            self.send_header('Location', '/PRIVATE_CATALOG_SENTINEL')
            self.end_headers()
            return
        entry = {'id': 'synthetic/model:exact', 'private': 'PRIVATE_CATALOG_SENTINEL'}
        if case == 'catalog-substituted':
            entry['id'] = 'synthetic/model:other'
        if case == 'catalog-invalid-id':
            entry.pop('id')
        if case == 'catalog-whitespace-id':
            entry['id'] += '\n'
        if case == 'catalog-invalid-metadata':
            entry['digest'] = 'PRIVATE_CATALOG_SENTINEL\n'
        if case == 'catalog-metadata':
            entry.update(runtime_version='1.2.3', digest='sha256:abc123', quantization='Q4_K_M', context_window=7, supports_tools=False)
        if case == 'catalog-metadata-length':
            entry['context_length'] = 7
        if case == 'catalog-metadata-aliases':
            entry.update(context_window=7, context_length=7)
        entry.update(catalog_context_failures.get(case, {}))
        body = json.dumps({'object': 'list', 'data': [] if case == 'catalog-missing' else [entry]}).encode()
        if case == 'catalog-malformed':
            body = b'{PRIVATE_CATALOG_SENTINEL'
        if case == 'catalog-duplicate':
            body = b'{"data":[{"id":"PRIVATE_CATALOG_SENTINEL","id":"synthetic/model:exact"}]}'
        if case == 'catalog-duplicate-id':
            body = json.dumps({'data': [entry, entry]}).encode()
        if case in ['catalog-oversized', 'catalog-chunked']:
            body = b' ' * (1024 * 1024 + 1)
        self.send_response(200)
        if case != 'catalog-chunked':
            self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if case == 'catalog-deadline':
            self.server.catalog_release.wait(15)
            return
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.server.calls += 1
        assert self.path == '/v1/chat/completions'
        assert body['model'] == 'synthetic/model:exact'
        reasoning = self.server.case in ['reasoning', 'reasoning-off']
        if reasoning:
            assert body.get('reasoning_effort') == ('none' if self.server.case == 'reasoning-off' else 'medium'), 'Selected effort did not use the configured Pi mapping'
            assert body['messages'][0]['role'] == 'developer', 'Configured developer role was ignored'
            assert all('reasoning_content' in message for message in body['messages'] if message['role'] == 'assistant'), 'Configured assistant reasoning field was ignored'
        else:
            assert 'reasoning_effort' not in body
        compacting = not body.get('tools')
        if compacting:
            assert self.server.case in ['compact', 'compact-failed']
            self.server.compactions += 1
        else:
            assert {'bash', 'edit', 'read', 'write', 'fixture_tool'} <= {t['function']['name'] for t in body['tools']}
            field = 'max_completion_tokens' if reasoning else 'max_tokens'
            assert body[field] == 8192, 'Configured output-limit parameter was ignored'
            assert ('max_tokens' if reasoning else 'max_completion_tokens') not in body, 'Output-limit parameter was substituted'
        assert self.headers.get('Authorization') in [None, 'Bearer tokate-no-auth'], 'Configured credentials escaped'
        text = json.dumps(body)
        assert 'PRIVATE_CREDENTIAL_SENTINEL' not in text
        if not compacting:
            assert 'CONFIGURED_CONTEXT_SENTINEL' in text
        for message in body['messages']:
            if message['role'] == 'tool':
                assert 'tokate-no-auth' not in str(message.get('content', '')), 'File tool exposed private model settings'
        if self.server.case == 'failed' or (compacting and self.server.case == 'compact-failed'):
            self.send_response(503)
            self.end_headers()
            return
        if self.server.case == 'malformed':
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            self.wfile.write(b'data: {broken}\n\n')
            self.close_connection = True
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        turn = sum(m['role'] == 'assistant' for m in body['messages'])
        if self.server.case in length_cases:
            delta = {'role': 'assistant', 'content': partial_text}
            if self.server.case == 'truncated-tool':
                delta['tool_calls'] = [{'index': 0, 'id': 'partial', 'type': 'function',
                    'function': {'name': 'bash', 'arguments': '{"command":"touch truncated-executed'}}]
            chunk = {'id': 'length', 'object': 'chat.completion.chunk', 'created': 1,
                     'model': 'synthetic/model:exact',
                     'choices': [{'index': 0, 'delta': delta, 'finish_reason': 'length'}],
                     'usage': {'prompt_tokens': 10, 'completion_tokens': 8192, 'total_tokens': 8202}}
            self.server.input_tokens += 10
            self.server.output_tokens += 8192
            self.wfile.write(('data: ' + json.dumps(chunk) + '\n\ndata: [DONE]\n\n').encode())
            self.close_connection = True
            return
        code = f"from pathlib import Path\nimport socket\ns=socket.socket(); s.settimeout(1); connected=False\ntry: s.connect(('127.0.0.1',{self.server.server_address[1]})); connected=True\nexcept OSError: pass\nassert connected\nPath('result.txt').write_text('final')"
        child_identity = 'printf "%s %s" "$(readlink /proc/self/ns/pid)" "$$" > child-identity; '
        planned = [('fixture_tool', {}), ('write', {'path': 'result.txt', 'content': 'before'}), ('read', {'path': 'result.txt'}),
                   ('edit', {'path': 'result.txt', 'edits': [{'oldText': 'before', 'newText': 'after'}]}),
                   ('bash', {'command': 'python3 -c ' + shlex.quote(code) + ' || echo TOOL_FAILURE', 'timeout': 4}),
                   ('bash', {'command': "setsid sh -c '" + child_identity + "sleep 30; touch timeout-escaped' & wait", 'timeout': 1})]
        if self.server.case in ['cancel', 'unlimited-cancel']:
            planned = [('bash', {'command': "setsid sh -c '" + child_identity + "touch running; sleep 30; touch cancel-escaped' & wait"})]
        elif self.server.case == 'unlimited':
            planned = [('bash', {'command': 'sleep 10; printf final > result.txt'})]
        if self.server.case in ['compact', 'compact-failed']:
            planned[1][1]['content'] = 'synthetic padding ' * 6000 + 'before'
        final = not compacting and turn >= len(planned)
        if compacting:
            chunk = {'choices': [{'index': 0, 'delta': {'role': 'assistant', 'content': 'Synthetic compacted task state.'}, 'finish_reason': 'stop'}]}
        elif self.server.case == 'empty':
            chunk = {'choices': [{'index': 0, 'delta': {'role': 'assistant', 'content': ''}, 'finish_reason': 'stop'}]}
        elif turn < len(planned):
            name, parameters = planned[turn]
            chunk = {'choices': [{'index': 0, 'delta': {'role': 'assistant', 'tool_calls': [{'index': 0, 'id': f'call_{turn}', 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(parameters)}}]}, 'finish_reason': 'tool_calls'}]}
        else:
            for message in body['messages']:
                if message['role'] == 'tool' and 'TOOL_FAILURE' in str(message.get('content', '')):
                    raise AssertionError('Tool check failed: ' + str(message.get('content', ''))[:2000])
            chunk = {'choices': [{'index': 0, 'delta': {'role': 'assistant', 'content': 'Changes: synthetic edits. Verification: constrained tools. Limitations: no inference.'}, 'finish_reason': 'stop'}]}
        tokens = 60000 if final and self.server.case in ['compact', 'compact-failed'] else 10
        self.server.input_tokens += tokens
        self.server.output_tokens += 5
        chunk.update(id=f'completion-{turn}', object='chat.completion.chunk', created=1, model='synthetic/model:exact', usage={'prompt_tokens': tokens, 'completion_tokens': 5, 'total_tokens': tokens + 5})
        self.wfile.write(('data: ' + json.dumps(chunk) + '\n\ndata: [DONE]\n\n').encode())
        self.close_connection = True

with Server(('127.0.0.1', 0), Handler) as server:
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    for case in cases:
        with tempfile.TemporaryDirectory(prefix='tokate-pi-proof-', dir='/var/tmp') as directory:
            root = Path(directory)
            server.root = root
            server.calls = 0
            server.catalog_calls = 0
            server.catalog_release = threading.Event()
            server.compactions = 0
            server.input_tokens = 0
            server.output_tokens = 0
            server.case = case
            server.errors = []
            fixture_root = root / 'fixtures'
            fixture_root.mkdir()
            env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TOKATE_TEST_ROOT': str(fixture_root),
                   'TOKATE_BINARY': str(Path(args.binary).resolve())}
            command = [args.tests, '--pi-proof', str(args.pi_root.resolve()), args.node, directory, f'http://127.0.0.1:{port}/v1', case]
            if case in ['cancel', 'unlimited-cancel']:
                process = subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
                try:
                    deadline = time.monotonic() + 45
                    fixture = None
                    ready = False
                    while time.monotonic() < deadline and process.poll() is None:
                        if (root / 'fixture.json').exists():
                            fixture = json.loads((root / 'fixture.json').read_text())
                            ready = (Path(fixture['checkout']) / 'running').exists()
                            if ready:
                                break
                        time.sleep(0.1)
                    assert fixture and ready, 'Pi never reached the cancellation boundary'
                    checkout = Path(fixture['checkout'])
                    git = (checkout / '.git/config').read_text()
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
                    process.communicate(timeout=15)
                    assert process.returncode == 0, 'Cancellation worker did not pass its checks'
                    assert checkout.is_dir(), 'Cancellation evidence disappeared'
                    assert not (checkout / 'cancel-escaped').exists(), 'Cancelled descendant survived'
                    assert (checkout / '.git/config').read_text() == git
                    saved = json.loads((Path(fixture['run']) / 'run.json').read_text())
                    assert saved['state'] == 'failed' and saved['failure_reason'] == 'inference_interrupted', {key: saved.get(key) for key in ['state', 'failure_stage', 'failure_reason', 'error']}
                    assert 'turn_completed' not in saved
                    assert saved['pi_version'] == metadata['version'], 'Pi version evidence does not match the installed package'
                    assert saved['observed_invocation']['sdk_version'] == metadata['version'], 'SDK version evidence is incorrect'
                    assert saved['observed_invocation']['node_version'] == node_version, 'Node version evidence is incorrect'
                    assert server.calls == 1, 'Cancellation scheduled another provider request'
                finally:
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(process.pid, signal.SIGKILL)
                    process.communicate(timeout=5)
            else:
                started = time.monotonic()
                try:
                    result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=150)
                finally:
                    server.catalog_release.set()
                if result.returncode != 0:
                    print('Protocol errors: ' + repr(server.errors), file=sys.stderr)
                    for evidence in [*root.rglob('events.jsonl'), *root.rglob('stderr.log')]:
                        print(evidence.read_text()[-6000:], file=sys.stderr)
                assert result.returncode == 0, f'{case}: {result.stdout}\n{result.stderr}'
                if case.startswith('catalog-') and case not in catalog_metadata_cases:
                    assert server.calls == 0, 'Unavailable metadata reached inference'
                    assert server.catalog_calls == (2 if case.startswith('catalog-recheck-') else 1), 'Metadata was retried or omitted'
                    if case == 'catalog-deadline':
                        assert time.monotonic() - started < 25, 'Metadata deadline was not bounded'
                    assert not server.errors, server.errors
                    print('PASS native Pi workflow ' + case, flush=True)
                    continue
                if case in ['compact', 'compact-failed']:
                    assert server.compactions > 0, 'Pi did not compact its configured context'
                elif case not in ['reasoning', 'reasoning-off', 'profile', 'on', 'unlimited', *catalog_metadata_cases, 'truncated-tool']:
                    assert server.calls == 1, f'{case}: automatic provider retry observed'
                saved = json.loads((root / 'result.json').read_text())
                if case in catalog_metadata_cases:
                    assert server.catalog_calls == 2, 'Metadata was retried or omitted'
                    assert not server.errors, server.errors
                if case in ['reasoning', 'reasoning-off', 'profile', 'on', 'unlimited', 'compact', *catalog_metadata_cases]:
                    assert saved['usage']['input_tokens'] == server.input_tokens, 'Usage omitted context compaction'
                    assert saved['usage']['output_tokens'] == server.output_tokens, 'Usage omitted context compaction'
                if case in length_cases:
                    expected = 'Runtime limit reached' if case == 'truncated-tool' else 'length limit'
                    assert expected in saved['error'], f"Truncation reason was not surfaced: {saved['state']} {saved['error']}"
            if case == 'truncated-tool':
                server.errors = [error for error in server.errors if 'Broken pipe' not in error]
            assert not server.errors, server.errors
            assert server.catalog_calls == (3 if case in ['profile', 'reasoning'] else 2), 'Metadata selection/launch checks were omitted or retried'
            if case in length_cases:
                evidence = json.loads((root / 'result.json').read_text())
                assert evidence['state'] == 'failed', 'Incomplete inference fabricated completion'
                lines = evidence['events'].splitlines()
                if case == 'truncated-tool' and not evidence['events'].endswith('\n'):
                    lines = lines[:-1]
                events = [json.loads(line) for line in lines]
                assistants = [event['message'] for event in events if event['type'] == 'message_end'
                              and event['message'].get('role') == 'assistant']
                assert assistants and assistants[-1]['stopReason'] == 'length', 'Native truncation was not retained'
            print('PASS native Pi workflow ' + case, flush=True)
    server.shutdown()
