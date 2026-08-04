import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = path.join(root, 'extension');
const releaseDir = path.join(root, 'release');
const packRoot = path.join('/tmp', 'opencodeqme-crx-pack');
const packExtensionDir = path.join(packRoot, 'extension');
const pemPath = path.join(releaseDir, 'opencodeqme-extension.pem');
const manifest = JSON.parse(readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const crxPath = path.join(releaseDir, `opencodeqme-extension-${manifest.version}.crx`);

execFileSync('node', [path.join(root, 'scripts/build-extension.mjs')], {
  cwd: root,
  stdio: 'inherit',
});

rmSync(packRoot, { recursive: true, force: true });
mkdirSync(packRoot, { recursive: true });
cpSync(extensionDir, packExtensionDir, { recursive: true });

const chromium = process.env.CHROMIUM_BIN
  || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : 'chromium');
const args = ['--pack-extension=' + packExtensionDir];
if (existsSync(pemPath)) {
  args.push('--pack-extension-key=' + pemPath);
}
execFileSync(chromium, args, { stdio: 'inherit' });

if (!existsSync(releaseDir)) mkdirSync(releaseDir, { recursive: true });
const tempCrx = path.join(packRoot, 'extension.crx');
const tempPem = path.join(packRoot, 'extension.pem');
if (!existsSync(tempCrx)) {
  throw new Error('Chromium did not produce a .crx file');
}
copyFileSync(tempCrx, crxPath);
if (existsSync(tempPem)) {
  copyFileSync(tempPem, pemPath);
}
rmSync(packRoot, { recursive: true, force: true });

console.log(`extension crx: ${crxPath}`);
if (existsSync(pemPath)) {
  console.log(`extension key: ${pemPath} (keep private, do not commit)`);
}
