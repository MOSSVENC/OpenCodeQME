import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';

export function packCrx({ extensionDir, outputPath, pemPath, packRoot }) {
  rmSync(packRoot, { recursive: true, force: true });
  mkdirSync(packRoot, { recursive: true });
  const packExtensionDir = path.join(packRoot, 'extension');
  cpSync(extensionDir, packExtensionDir, { recursive: true });

  const chromium = process.env.CHROMIUM_BIN
    || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : 'chromium');
  const args = [`--pack-extension=${packExtensionDir}`];
  if (existsSync(pemPath)) {
    args.push(`--pack-extension-key=${pemPath}`);
  }
  execFileSync(chromium, args, { stdio: 'inherit' });

  const tempCrx = path.join(packRoot, 'extension.crx');
  if (!existsSync(tempCrx)) {
    throw new Error('Chromium did not produce a .crx file');
  }
  const tempPem = path.join(packRoot, 'extension.pem');
  mkdirSync(path.dirname(outputPath), { recursive: true });
  rmSync(outputPath, { force: true });
  copyFileSync(tempCrx, outputPath);
  return tempPem;
}
