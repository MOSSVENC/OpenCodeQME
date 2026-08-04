import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = path.join(root, 'extension');
const releaseDir = path.join(root, 'release');
const zipPath = path.join(releaseDir, '68hub-material-extension.zip');

const manifest = JSON.parse(readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
execFileSync('node', [path.join(root, 'scripts/test-extension.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
for (const file of [
  'background.js',
  'content.js',
  'popup.js',
  'shared/parsers.js',
  'shared/fetchers.js',
  'shared/history.js',
]) {
  execFileSync('node', ['--check', path.join(extensionDir, file)], {
    cwd: root,
    stdio: 'inherit',
  });
}

if (!existsSync(releaseDir)) mkdirSync(releaseDir, { recursive: true });
rmSync(zipPath, { force: true });
execFileSync('zip', ['-r', zipPath, 'extension'], {
  cwd: root,
  stdio: 'inherit',
});

console.log(`extension manifest v${manifest.version} validated`);
console.log(`extension bundle: ${zipPath}`);
