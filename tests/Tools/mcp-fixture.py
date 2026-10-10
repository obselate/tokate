import json
from pathlib import Path
import sys

checkout = Path(sys.argv[1])
for line in sys.stdin:
    request = json.loads(line)
    if 'id' not in request:
        continue
    method = request.get('method')
    if method == 'initialize':
        result = {'protocolVersion': request['params']['protocolVersion'], 'capabilities': {'tools': {}},
                  'serverInfo': {'name': 'fixture', 'version': '1.0.0'}}
    elif method == 'tools/list':
        result = {'tools': [{'name': 'marker', 'description': 'Write a configured tool marker.',
                            'inputSchema': {'type': 'object', 'properties': {}}}]}
    elif method == 'tools/call':
        assert request['params']['name'] == 'marker'
        (checkout / 'custom.txt').write_text('configured tool worked')
        result = {'content': [{'type': 'text', 'text': 'configured tool worked'}]}
    else:
        result = {}
    print(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}), flush=True)
