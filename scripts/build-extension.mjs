import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = path.join(root, 'extension');
const releaseDir = path.join(root, 'release');

const manifest = JSON.parse(readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const isRelease = process.argv.includes('--release');
const suffixIndex = process.argv.indexOf('--suffix');
const suffix = suffixIndex >= 0
  ? String(process.argv[suffixIndex + 1] || manifest.version).trim()
  : manifest.version;
const outputDir = isRelease ? releaseDir : path.join(root, 'release-test');
const zipName = isRelease
  ? `opencodeqme-extension-${suffix}.zip`
  : 'opencodeqme-extension.zip';
const zipPath = path.join(outputDir, zipName);
execFileSync('node', [path.join(root, 'scripts/test-extension.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
for (const file of [
  'background.js',
  'popup.js',
  'tab.js',
  'shared/i18n.js',
  'shared/parsers.js',
  'shared/fetchers.js',
  'shared/history.js',
]) {
  execFileSync('node', ['--check', path.join(extensionDir, file)], {
    cwd: root,
    stdio: 'inherit',
  });
}

if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
rmSync(zipPath, { force: true });
execFileSync('zip', ['-r', zipPath, 'extension'], {
  cwd: root,
  stdio: 'inherit',
});

console.log(`extension manifest v${manifest.version} validated`);
console.log(`extension bundle: ${zipPath}`);
