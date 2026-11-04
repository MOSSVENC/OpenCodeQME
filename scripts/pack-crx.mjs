import {
  constants,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createZipBuffer } from './zip.mjs';

const CRX_MAGIC = Buffer.from('Cr24');
const CRX_VERSION = 3;
const SIGNED_DATA_PREFIX = Buffer.from('CRX3 SignedData\0', 'binary');

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function encodeVarint(value) {
  const bytes = [];
  let remaining = value >>> 0;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining) byte |= 0x80;
    bytes.push(byte);
  } while (remaining);
  return Buffer.from(bytes);
}

function protobufBytes(field, value) {
  return Buffer.concat([encodeVarint((field << 3) | 2), encodeVarint(value.length), value]);
}

function readVarint(buffer, start) {
  let value = 0;
  let shift = 0;
  let offset = start;
  while (offset < buffer.length) {
    const byte = buffer[offset];
    offset += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [value >>> 0, offset];
    shift += 7;
    if (shift > 35) throw new Error('Invalid protobuf varint');
  }
  throw new Error('Truncated protobuf varint');
}

function parseProtobuf(buffer) {
  const fields = [];
  let offset = 0;
  while (offset < buffer.length) {
    const [key, next] = readVarint(buffer, offset);
    offset = next;
    const field = key >>> 3;
    const wireType = key & 7;
    if (wireType === 2) {
      const [length, valueOffset] = readVarint(buffer, offset);
      const end = valueOffset + length;
      if (end > buffer.length) throw new Error('Truncated protobuf field');
      fields.push({ field, wireType, value: buffer.subarray(valueOffset, end) });
      offset = end;
    } else if (wireType === 0) {
      const [value, valueOffset] = readVarint(buffer, offset);
      fields.push({ field, wireType, value });
      offset = valueOffset;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wireType}`);
    }
  }
  return fields;
}

function verifyCrx(buffer) {
  if (buffer.subarray(0, 4).toString() !== CRX_MAGIC.toString()) {
    throw new Error('CRX magic mismatch');
  }
  if (buffer.readUInt32LE(4) !== CRX_VERSION) throw new Error('CRX version mismatch');
  const headerLength = buffer.readUInt32LE(8);
  const header = buffer.subarray(12, 12 + headerLength);
  const zip = buffer.subarray(12 + headerLength);
  const fields = parseProtobuf(header);
  const rsaProof = fields.find((field) => field.field === 2);
  const signedHeader = fields.find((field) => field.field === 10000)?.value;
  if (!rsaProof || !signedHeader) throw new Error('CRX header is missing RSA proof or signed data');
  const proofFields = parseProtobuf(rsaProof.value);
  const publicKeyDer = proofFields.find((field) => field.field === 1)?.value;
  const signature = proofFields.find((field) => field.field === 2)?.value;
  if (!publicKeyDer || !signature) throw new Error('CRX RSA proof is incomplete');
  const publicKey = createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
  const payload = Buffer.concat([
    SIGNED_DATA_PREFIX,
    uint32(signedHeader.length),
    signedHeader,
    zip,
  ]);
  if (!verify('sha256', payload, publicKey, signature)) {
    throw new Error('CRX signature verification failed');
  }
  const crxId = parseProtobuf(signedHeader).find((field) => field.field === 1)?.value;
  const expectedId = createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
  if (!crxId || !crxId.equals(expectedId)) throw new Error('CRX ID mismatch');
  return true;
}

function chromiumBinary() {
  const candidates = [
    process.env.CHROMIUM_BIN,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function packWithChromium({ extensionDir, outputPath, pemPath, packRoot }) {
  rmSync(packRoot, { recursive: true, force: true });
  mkdirSync(packRoot, { recursive: true });
  const packExtensionDir = path.join(packRoot, 'extension');
  cpSync(extensionDir, packExtensionDir, { recursive: true });

  const args = [`--pack-extension=${packExtensionDir}`];
  if (existsSync(pemPath)) args.push(`--pack-extension-key=${pemPath}`);
  execFileSync(chromiumBinary(), args, { stdio: 'inherit' });

  const tempCrx = path.join(packRoot, 'extension.crx');
  if (!existsSync(tempCrx)) throw new Error('Chromium did not produce a .crx file');
  const crx = readFileSync(tempCrx);
  verifyCrx(crx);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, crx);
  const tempPem = path.join(packRoot, 'extension.pem');
  return existsSync(tempPem) ? tempPem : null;
}

function packWithNode({ zipPath, extensionDir, outputPath, pemPath, packRoot }) {
  rmSync(packRoot, { recursive: true, force: true });
  mkdirSync(packRoot, { recursive: true });

  let privateKey;
  let tempPem = null;
  if (existsSync(pemPath)) {
    privateKey = createPrivateKey(readFileSync(pemPath));
  } else {
    const generated = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = createPrivateKey(generated.privateKey);
    tempPem = path.join(packRoot, 'extension.pem');
    writeFileSync(tempPem, generated.privateKey);
  }

  const publicKeyDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const crxId = createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
  const signedHeaderData = protobufBytes(1, crxId);
  const zip = zipPath && existsSync(zipPath)
    ? readFileSync(zipPath)
    : createZipBuffer(extensionDir, 'extension');
  const payload = Buffer.concat([
    SIGNED_DATA_PREFIX,
    uint32(signedHeaderData.length),
    signedHeaderData,
    zip,
  ]);
  const signature = sign('sha256', payload, {
    key: privateKey,
    padding: constants.RSA_PKCS1_PADDING,
  });
  const proof = Buffer.concat([
    protobufBytes(1, publicKeyDer),
    protobufBytes(2, signature),
  ]);
  const header = Buffer.concat([
    protobufBytes(2, proof),
    protobufBytes(10000, signedHeaderData),
  ]);
  const crx = Buffer.concat([
    CRX_MAGIC,
    uint32(CRX_VERSION),
    uint32(header.length),
    header,
    zip,
  ]);
  verifyCrx(crx);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, crx);
  return tempPem;
}

export function packCrx({ extensionDir, outputPath, pemPath, packRoot, zipPath }) {
  const chromium = chromiumBinary();
  if (chromium) {
    return packWithChromium({ extensionDir, outputPath, pemPath, packRoot });
  }
  console.log('Chromium not found; using built-in Node CRX3 packer');
  return packWithNode({ zipPath, extensionDir, outputPath, pemPath, packRoot });
}

export { verifyCrx };
