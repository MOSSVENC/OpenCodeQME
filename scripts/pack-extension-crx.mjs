import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = path.join(root, 'extension');
const releaseDir = path.join(root, 'release');
const packRoot = path.join('/tmp', 'opencodeqme-crx-pack');
const packExtensionDir = path.join(packRoot, 'extension');
const pemPath = path.join(releaseDir, 'opencodeqme-extension.pem');
const manifestPath = path.join(extensionDir, 'manifest.json');
const packagePath = path.join(root, 'package.json');
const manifest = JSON.parse(readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const VERSION_RE = /^\d+\.\d+\.\d+$/;

const envSuffix = process.env.OPENCODE_RELEASE_SUFFIX?.trim() || '';
const suffixIndex = process.argv.indexOf('--suffix');
const argSuffix = suffixIndex >= 0
  ? String(process.argv[suffixIndex + 1] || '').trim()
  : '';
let version = envSuffix || argSuffix || '';

console.log(`当前版本: ${manifest.version}`);

if (!envSuffix && !argSuffix) {
  const rl = createInterface({ input: stdin, output: stdout });
  while (!version) {
    const entered = (await rl.question(
      `请输入下一个版本号（直接回车保持 ${manifest.version}）: `,
    )).trim();
    if (!entered) {
      version = manifest.version;
      break;
    }
    if (VERSION_RE.test(entered)) {
      version = entered;
      break;
    }
    console.log('版本号格式应为 x.y.z，请重新输入');
  }
  const confirmed = (await rl.question(
    `确认将版本更新为 ${version} 并构建 release？(y/N) `,
  )).trim().toLowerCase();
  rl.close();
  if (confirmed !== 'y' && confirmed !== 'yes') {
    console.log('已取消 release 构建');
    process.exit(0);
  }
}

if (!VERSION_RE.test(version)) {
  throw new Error(`无效版本号: ${version}`);
}

const suffix = version;
const nextManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const nextPackage = JSON.parse(readFileSync(packagePath, 'utf8'));
let versionChanged = false;
if (nextManifest.version !== suffix) {
  nextManifest.version = suffix;
  versionChanged = true;
}
if (nextPackage.version !== suffix) {
  nextPackage.version = suffix;
  versionChanged = true;
}
if (versionChanged) {
  writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
  writeFileSync(packagePath, `${JSON.stringify(nextPackage, null, 2)}\n`);
  console.log(`版本已更新为 ${suffix}`);
}

const crxPath = path.join(releaseDir, `opencodeqme-extension-${suffix}.crx`);

execFileSync('node', [
  path.join(root, 'scripts/build-extension.mjs'),
  '--release',
  '--suffix',
  suffix,
], {
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
console.log(`release suffix: ${suffix}`);
if (existsSync(pemPath)) {
  console.log(`extension key: ${pemPath} (keep private, do not commit)`);
}
