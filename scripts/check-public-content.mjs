#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const patterns = [
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['api-key', /\b(?:sk|rk)-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ['aws-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['private-key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['machine-home-path', /(?:\/home\/|\/Users\/)[A-Za-z0-9_.-]+\/[^\s\0"'<>`]+|[A-Za-z]:\\Users\\[^\s\0"'<>`]+/],
  ['credential-assignment', /\b(?:password|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[=:]\s*["']?[A-Za-z0-9_+/=-]{12,}/i],
  ['url-credential', /https?:\/\/[^\s/@]+:[^\s/@]+@/i],
  ['source-map', /sourceMappingURL\s*=|"sourcesContent"\s*:/],
];

export function privatePath(name) {
  return name.split('/').some(part =>
    /^(?:\.git|\.tokate(?:-scratch)?|\.state|\.runs|\.codex|\.config|\.ssh|\.aws|\.private|\.env(?:\..*)?|auth\.json|credentials\.json|hosts\.yml)$/i.test(part)) ||
    /\.(?:pem|key|pfx|p12|log|jsonl|dmp|core|map|user)$/i.test(name);
}

export function contentFindings(data) {
  const text = data.toString('utf8');
  // Binary assets can carry UTF-16 strings (font names and diagnostic paths).
  const swapped = Buffer.from(data.subarray(0, data.length - data.length % 2));
  swapped.swap16();
  const texts = [text, data.toString('utf16le'), swapped.toString('utf16le')];
  const result = [];
  for (const [category, pattern] of patterns) {
    for (const candidate of texts) {
      const match = pattern.exec(candidate);
      if (match) {
        result.push({ category, line: candidate === text ? text.slice(0, match.index).split('\n').length : null });
        break;
      }
    }
  }
  if (imageMetadata(data)) result.push({ category: 'image-text-or-location-metadata', line: null });
  return result;
}

function imageMetadata(data) {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    for (let offset = 8; offset + 12 <= data.length;) {
      const size = data.readUInt32BE(offset);
      if (offset + size + 12 > data.length) throw new Error('invalid PNG');
      const tag = data.toString('ascii', offset + 4, offset + 8);
      if (['tEXt', 'zTXt', 'iTXt', 'eXIf'].includes(tag)) return true;
      offset += size + 12;
    }
  } else if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    for (let offset = 12; offset + 8 <= data.length;) {
      const size = data.readUInt32LE(offset + 4);
      if (offset + size + 8 > data.length) throw new Error('invalid WebP');
      if (['EXIF', 'XMP '].includes(data.toString('ascii', offset, offset + 4))) return true;
      offset += size + 8 + size % 2;
    }
  } else if (data[0] === 255 && data[1] === 216) {
    for (let offset = 2; offset + 4 <= data.length && data[offset] === 255;) {
      const marker = data[offset + 1];
      if (marker === 218 || marker === 217) break;
      const size = data.readUInt16BE(offset + 2);
      if (size < 2 || offset + size + 2 > data.length) throw new Error('invalid JPEG');
      // APP1 carries EXIF/XMP, APP13 can carry Photoshop/IPTC personal metadata.
      if ([225, 237].includes(marker)) return true;
      offset += size + 2;
    }
  }
  return false;
}

function safeLocation(name) {
  // Do not echo arbitrary filenames: they can themselves contain a secret.
  return 'path-sha256:' + createHash('sha256').update(name).digest('hex').slice(0, 16);
}

export function checkFiles(directory, files) {
  const findings = [];
  for (const name of files) {
    const location = safeLocation(name);
    if (isAbsolute(name) || name.includes('\\') || name.split('/').some(x => !x || x === '..' || x === '.')) {
      findings.push({ location, category: 'unsafe-path' });
      continue;
    }
    if (privatePath(name)) {
      findings.push({ location, category: 'private-or-diagnostic-file' });
      continue; // Never open credential stores, environment files or run artifacts.
    }
    try {
      const path = join(directory, name);
      // Reject symlinks in every component, including parent directories.
      let component = directory;
      let safe = true;
      for (const part of name.split('/')) {
        component = join(component, part);
        if (lstatSync(component).isSymbolicLink()) { safe = false; break; }
      }
      if (!safe || !lstatSync(path).isFile()) {
        findings.push({ location, category: 'symlink-or-nonregular-file' });
        continue;
      }
      for (const finding of contentFindings(readFileSync(path))) findings.push({ location, ...finding });
    } catch {
      findings.push({ location, category: 'unreadable-or-invalid-file' });
    }
  }
  return findings;
}

function websiteFiles(directory, prefix = 'site') {
  const files = [];
  for (const entry of readdirSync(join(directory, prefix), { withFileTypes: true })) {
    const name = prefix + '/' + entry.name;
    // Do not traverse private or unexpected directories, or follow symlinks.
    if (entry.isDirectory() && !privatePath(name) && name === 'site/assets') files.push(...websiteFiles(directory, name));
    else files.push(name);
  }
  return files;
}

export function checkWebsite(directory, allowed) {
  const actual = websiteFiles(directory);
  const approved = new Set(allowed);
  const findings = actual.filter(name => !approved.has(name)).map(name => ({ location: safeLocation(name), category: 'unapproved-website-file' }));
  for (const name of allowed) if (!actual.includes(name)) findings.push({ location: safeLocation(name), category: 'missing-website-file' });
  return [...findings, ...checkFiles(directory, actual.filter(name => approved.has(name)))];
}

export function stageRelease(directory, destination, files) {
  const findings = checkFiles(directory, files);
  if (findings.length) return findings;
  // A fresh destination prevents stale files from earlier bundles entering tar.
  mkdirSync(destination);
  for (const name of files) {
    const target = join(destination, name);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(directory, name), target);
  }
  return [];
}

function main(args) {
  const manifest = JSON.parse(readFileSync(join(root, 'scripts/publication-files.json'), 'utf8'));
  let findings;
  if (args.length === 2 && args[0] === '--stage-release') {
    findings = checkFiles(root, ['artifacts/linux-x64/tokate']);
    if (!findings.length) findings = stageRelease(root, resolve(args[1]), manifest.release);
  } else if (!args.length || (args.length === 2 && args[0] === '--files-from')) {
    // --files-from permits a public API inventory when task .git access is denied.
    const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
    Object.assign(gitEnv, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
    const files = args.length ? JSON.parse(readFileSync(args[1], 'utf8')) :
      execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', 'ls-files', '-z'], { cwd: root, env: gitEnv, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8').split('\0').filter(Boolean);
    findings = [...checkFiles(root, files), ...checkWebsite(root, manifest.website)];
  } else throw new Error('usage');
  for (const finding of findings) console.error('public-content: ' + JSON.stringify(finding));
  if (findings.length) process.exitCode = 1;
  else console.log('Public content guard passed (heuristic coverage; manual audit still required).');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch { console.error('Public content guard could not complete; no file contents or exception details logged.'); process.exitCode = 1; }
}
