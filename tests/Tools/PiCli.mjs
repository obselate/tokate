#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--version')) {
    const metadata = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    console.log(metadata.version);
    process.exit(0);
}
const model = args[args.indexOf('--model') + 1];
const provider = args[args.indexOf('--provider') + 1];
const cwd = process.cwd();
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const emit = event => console.log(JSON.stringify(event));
emit({ type: 'agent_start' });
emit({ type: 'tool_execution_start', toolName: 'write', args: { prompt } });
await writeFile(path.join(cwd, 'tracked.txt'), 'preserved\n');
await writeFile(path.join(cwd, 'imported.txt'), 'untracked\n');
if (!prompt.startsWith('This is a fresh v2 attempt seeded from unpublished interrupted work.') &&
    !prompt.startsWith('Continue the published work of another donor from preserved commit ')) {
    await mkdir(path.join(cwd, '.verification-data'), { recursive: true });
    await writeFile(path.join(cwd, '.verification-data/source-only'), 'Preserved source fixture output.');
    await new Promise(resolve => setTimeout(resolve, 120000));
}
await writeFile(path.join(cwd, 'result.txt'), 'Completed Pi continuation fixture\n');
await writeFile(path.join(cwd, 'tokate-public-summary.json'), JSON.stringify({
    changes: ['Add a completed deterministic Pi fixture result.'], verification: [], limitations: [],
}));
emit({ type: 'message_end', message: {
    role: 'assistant', model, provider, stopReason: 'stop', usage: { input: 100, cacheRead: 0, output: 10 },
    content: [{ type: 'text', text: 'Completed deterministic Pi coding turn.' }],
} });
emit({ type: 'agent_end' });
emit({ type: 'agent_settled', aborted: false });
