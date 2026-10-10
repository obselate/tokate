#!/usr/bin/env python3
import argparse
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

spec = importlib.util.spec_from_file_location('native_proof', Path(__file__).with_name('native-proof.py'))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class Handler(native.Handler):
    def exec_call(self, name, call):
        return {'type': 'custom_tool_call', 'id': 'ctc_' + name, 'call_id': 'call_' + name, 'status': 'completed',
                'name': 'exec', 'input': 'text(JSON.stringify(' + call + '));\n'}

    def do_POST(self):
        if self.path != '/v1/responses':
            self.reject()
            return
        body = self.rfile.read(int(self.headers['Content-Length']))
        if self.headers.get('Content-Encoding') == 'zstd':
            body = subprocess.run(['zstd', '-dcq'], input=body, capture_output=True, check=True).stdout
        body = json.loads(body)
        self.server.requests.append(body)
        step = len(self.server.requests)
        tools = {tool.get('name') for item in body['input'] if item.get('type') == 'additional_tools'
                 for namespace in item['tools'] for tool in namespace.get('tools', [])}
        if step <= 2:
            native.require('exec' in tools, 'Code-mode exec tool was not offered')
        if step == 1:
            item = self.exec_call('mcp', 'await tools.mcp__fixture__marker({})')
        elif step == 2:
            native.require('configured tool worked' in json.dumps(body), 'Configured MCP tool failed')
            item = self.exec_call('shell', "await tools.exec_command({cmd: 'printf final > result.txt', yield_time_ms: 1000})")
        else:
            item = {'type': 'message', 'id': 'msg_final', 'role': 'assistant', 'status': 'completed',
                    'content': [{'type': 'output_text', 'text': 'Changes: Add the fixture result. Verification: Run configured tools. Limitations: No live inference.', 'annotations': []}]}
        native.require(body['model'] == native.MODEL, 'Native CLI changed the model')
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Connection', 'close')
        self.end_headers()
        response = {'id': f'resp_{step}', 'object': 'response', 'model': body['model'], 'status': 'completed',
                    'output': [item], 'usage': {'input_tokens': 10, 'output_tokens': 5, 'total_tokens': 15}}
        for event in [
            {'type': 'response.created', 'response': {**response, 'status': 'in_progress', 'output': []}},
            {'type': 'response.output_item.added', 'output_index': 0, 'item': item},
            {'type': 'response.output_item.done', 'output_index': 0, 'item': item},
            {'type': 'response.completed', 'response': response},
        ]:
            self.wfile.write(('event: ' + event['type'] + '\ndata: ' + json.dumps(event) + '\n\n').encode())
            self.wfile.flush()
        self.close_connection = True


def main():
    parser = argparse.ArgumentParser(description='Installed Codex configured-tool proof against a local synthetic server')
    parser.add_argument('--codex', required=True, type=Path)
    parser.add_argument('--binary', type=Path, default=Path('artifacts/linux-x64/tokate'))
    parser.add_argument('--tests', type=Path, default=Path('artifacts/tests/tokate-tests'))
    parser.add_argument('--inside', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not args.inside:
        sys.exit(subprocess.run(['/usr/bin/bwrap', '--die-with-parent', '--unshare-user', '--unshare-net',
            '--bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--', sys.executable,
            str(Path(__file__).resolve()), '--codex', str(args.codex.resolve()),
            '--binary', str(args.binary.resolve()), '--tests', str(args.tests.resolve()), '--inside'], timeout=180).returncode)
    with tempfile.TemporaryDirectory(prefix='tokate-codex-proof-', dir='/var/tmp') as name:
        root = Path(name)
        proof = native.Proof(args.codex.resolve(), root)
        proof.fixture.close()
        proof.fixture = native.Fixture()
        proof.fixture.RequestHandlerClass = Handler
        try:
            profile = proof.home('chatgpt') / 'native'
            auth = json.loads((profile / 'auth.json').read_text())
            auth['last_refresh'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            (root / 'auth.json').write_text(json.dumps(auth))
            shutil.copyfile(Path(__file__).resolve().parent.parent / 'tests/Tools/mcp-fixture.py', root / 'mcp.py')
            env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TOKATE_BINARY': str(args.binary.resolve())}
            result = subprocess.run([str(args.tests.resolve()), '--codex-proof', str(args.codex.resolve()),
                str(root), proof.fixture.endpoint], capture_output=True, text=True, env=env, timeout=150)
            if result.returncode:
                for path in [root / 'result.txt', root / 'stderr.log', root / 'events.jsonl']:
                    if path.exists():
                        print(path.read_text()[-8000:], file=sys.stderr)
                print(result.stderr, file=sys.stderr)
            native.require(result.returncode == 0, 'Managed native Codex proof failed')
            native.require(len(proof.fixture.requests) == 3, 'Unexpected native request or retry count')
            print(result.stdout.strip(), flush=True)
        finally:
            proof.fixture.close()


if __name__ == '__main__':
    main()
