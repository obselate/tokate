import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkFiles, checkWebsite, contentFindings, privatePath, root, stageRelease } from '../scripts/check-public-content.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'tokate-public-fixture-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('synthetic credentials and paths are detected without returning values', () => {
  const examples = [
    ['gh' + 'p_' + 'A'.repeat(36), 'github-token'],
    ['github_' + 'pat_' + 'B'.repeat(60), 'github-token'],
    ['sk' + '-' + 'C'.repeat(40), 'api-key'],
    ['AK' + 'IA' + 'D'.repeat(16), 'aws-key'],
    ['-----BEGIN ' + 'PRIVATE KEY-----', 'private-key'],
    ['/home' + '/synthetic-person/private/build', 'machine-home-path'],
    ['C:' + '\\Users\\synthetic-person\\build', 'machine-home-path'],
    ['api_' + 'key=' + 'E'.repeat(24), 'credential-assignment'],
    ['https://' + 'synthetic:' + 'F'.repeat(24) + '@example.invalid', 'url-credential'],
    ['//# source' + 'MappingURL=app.js.map', 'source-map'],
  ];
  for (const [value, category] of examples) {
    const findings = contentFindings(Buffer.from('safe line\n' + value));
    assert.ok(findings.some(f => f.category === category && f.line === 2));
    assert.ok(!JSON.stringify(findings).includes(value));
  }
  const utf16 = Buffer.from(examples[0][0], 'utf16le');
  assert.ok(contentFindings(utf16).some(f => f.category === 'github-token'));
  assert.ok(contentFindings(Buffer.from(utf16).swap16()).some(f => f.category === 'github-token'));
  assert.deepEqual(contentFindings(Buffer.from('HOME PATH TOKEN_NAME ~/.local/bin example@example.invalid')), []);
});

test('private filenames are rejected before attempting to read them', t => {
  const directory = fixture(t);
  for (const name of ['.env', 'nested/.env.production', '.tokate-scratch/run.json', '.codex/auth.json', '.ssh/id_rsa', 'credentials.json', 'trace.jsonl', 'client.pfx', 'app.js.map']) {
    assert.equal(privatePath(name), true);
    // These paths do not exist: trying to read them would throw.
    assert.equal(checkFiles(directory, [name])[0].category, 'private-or-diagnostic-file');
  }
  for (const name of ['../outside.txt', '/outside.txt', 'nested/../../outside.txt', 'nested\\outside.txt']) assert.equal(checkFiles(directory, [name])[0].category, 'unsafe-path');
  assert.equal(checkFiles(directory, ['missing.txt'])[0].category, 'unreadable-or-invalid-file');
});

test('website inventory rejects hidden files, new assets and directory symlinks', t => {
  const directory = fixture(t);
  mkdirSync(join(directory, 'site/assets'), { recursive: true });
  writeFileSync(join(directory, 'site/index.html'), 'public');
  writeFileSync(join(directory, 'site/assets/icon.svg'), '<svg/>');
  const allowed = ['site/index.html', 'site/assets/icon.svg'];
  assert.deepEqual(checkWebsite(directory, allowed), []);
  writeFileSync(join(directory, 'site/.env'), 'synthetic private fixture');
  writeFileSync(join(directory, 'site/assets/debug.txt'), 'synthetic diagnostics');
  assert.equal(checkWebsite(directory, allowed).filter(f => f.category === 'unapproved-website-file').length, 2);
  rmSync(join(directory, 'site/assets'), { recursive: true });
  mkdirSync(join(directory, 'other'));
  writeFileSync(join(directory, 'other/icon.svg'), '<svg/>');
  symlinkSync(join(directory, 'other'), join(directory, 'site/assets'));
  assert.equal(checkFiles(directory, ['site/assets/icon.svg'])[0].category, 'symlink-or-nonregular-file');
});

test('image text and location metadata are rejected', () => {
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from([0, 0, 0, 4]), Buffer.from('tEXt'), Buffer.from('fake'), Buffer.alloc(4)]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPEXIF'), Buffer.from([4, 0, 0, 0]), Buffer.from('fake')]);
  const jpeg = Buffer.from([255, 216, 255, 225, 0, 6, 102, 97, 107, 101]);
  for (const data of [png, webp, jpeg]) assert.ok(contentFindings(data).some(f => f.category === 'image-text-or-location-metadata'));
});

test('release staging copies only approved files and rejects stale destinations', t => {
  const directory = fixture(t);
  mkdirSync(join(directory, 'docs'));
  writeFileSync(join(directory, 'docs/public.md'), 'public');
  writeFileSync(join(directory, 'docs/private.txt'), 'synthetic private fixture');
  const destination = join(directory, 'bundle');
  assert.deepEqual(stageRelease(directory, destination, ['docs/public.md']), []);
  assert.equal(existsSync(join(destination, 'docs/private.txt')), false);
  assert.throws(() => stageRelease(directory, destination, ['docs/public.md']));
});

test('package command excludes unapproved documents and previous bundle contents', t => {
  const directory = fixture(t);
  for (const name of ['scripts', 'docs', 'site', 'fake-bin', 'artifacts/linux-x64', 'artifacts/tokate-0.0.0-linux-x64']) mkdirSync(join(directory, name), { recursive: true });
  for (const name of ['package.sh', 'check-public-content.mjs']) copyFileSync(join(root, 'scripts', name), join(directory, 'scripts', name));
  writeFileSync(join(directory, 'scripts/publication-files.json'), JSON.stringify({ website: ['site/index.html'], release: ['docs/public.md'] }));
  writeFileSync(join(directory, '.gitignore'), 'artifacts/\n');
  writeFileSync(join(directory, 'site/index.html'), 'public');
  writeFileSync(join(directory, 'docs/public.md'), 'public');
  writeFileSync(join(directory, 'docs/unapproved.txt'), 'synthetic unapproved document');
  writeFileSync(join(directory, 'artifacts/tokate-0.0.0-linux-x64/stale.txt'), 'synthetic stale diagnostic');
  writeFileSync(join(directory, 'fake-bin/dotnet'), '#!/bin/sh\necho 0.0.0\n');
  writeFileSync(join(directory, 'artifacts/linux-x64/tokate'), '#!/bin/sh\necho "tokate 0.0.0"\n');
  chmodSync(join(directory, 'fake-bin/dotnet'), 0o755);
  chmodSync(join(directory, 'artifacts/linux-x64/tokate'), 0o755);
  const env = { PATH: join(directory, 'fake-bin') + ':/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  execFileSync('git', ['init', '--quiet', directory], { env, stdio: 'pipe' });
  execFileSync('git', ['-C', directory, 'add', '.'], { env, stdio: 'pipe' });
  const result = spawnSync('bash', ['scripts/package.sh'], { cwd: directory, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const members = execFileSync('tar', ['-tzf', join(directory, 'artifacts/tokate-0.0.0-linux-x64.tar.gz')], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(members.includes('tokate-0.0.0-linux-x64/docs/public.md'));
  assert.ok(members.includes('tokate-0.0.0-linux-x64/tokate'));
  assert.ok(!members.some(name => name.endsWith('stale.txt') || name.endsWith('unapproved.txt')));
});

test('ignore rules cover private artifacts at root and nested paths', t => {
  const directory = fixture(t);
  copyFileSync(join(root, '.gitignore'), join(directory, '.gitignore'));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  execFileSync('git', ['init', '--quiet', directory], { env, stdio: 'pipe' });
  const paths = ['.tokate-scratch/run.json', 'nested/.tokate-scratch/run.json', '.env', 'site/.env.production', '.codex/auth.json', '.ssh/id_rsa', 'nested/credentials.json', 'site/debug.log', 'client.pfx', 'client.pem', 'site/app.js.map'];
  const result = spawnSync('git', ['-C', directory, 'check-ignore', '--stdin'], { env, input: paths.join('\n') + '\n', encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.deepEqual(result.stdout.trim().split('\n'), paths);
  assert.equal(spawnSync('git', ['-C', directory, 'check-ignore', 'site/app.js', 'docs/transparency.md'], { env, stdio: 'pipe' }).status, 1);
});

test('CLI output redacts secret values and filenames and exits with failure', t => {
  const directory = fixture(t);
  const secret = 'gh' + 'p_' + 'Z'.repeat(36);
  const manifest = join(directory, 'files.json');
  writeFileSync(manifest, JSON.stringify(['site/.env.' + secret]));
  const result = spawnSync(process.execPath, [join(root, 'scripts/check-public-content.mjs'), '--files-from', manifest], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('private-or-diagnostic-file'));
  assert.ok(!result.stderr.includes(secret));
  assert.ok(!result.stdout.includes(secret));
  const missingTool = spawnSync(process.execPath, [join(root, 'scripts/check-public-content.mjs')], { env: { PATH: directory }, encoding: 'utf8' });
  assert.equal(missingTool.status, 1);
  assert.ok(missingTool.stderr.includes('could not complete'));
});
