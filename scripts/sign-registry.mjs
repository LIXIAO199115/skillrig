#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { PACKAGE_ROOT, ensureDir, atomicWriteFile } from '../src/core/util.mjs';
import { generateSigningKeyPair, signRegistry, verifyRegistry, keyIdFor } from '../src/core/registry.mjs';

const ROOT = PACKAGE_ROOT;
const DEFAULT_INDEX = path.join(ROOT, 'registry', 'index.json');
const DEFAULT_SIG = path.join(ROOT, 'registry', 'index.json.sig');
const DEFAULT_PUBLIC = path.join(ROOT, 'registry', 'keys', 'skillrig.pub.pem');
const DEFAULT_KEY_DIR = path.join(os.homedir(), '.skillrig', 'keys');
const DEFAULT_PRIVATE = path.join(DEFAULT_KEY_DIR, 'skillrig.private.pem');

function parseArgs(argv) {
  const opts = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    opts[key] = rest.length ? rest.join('=') : true;
  }
  return opts;
}

function generate(opts) {
  const keyDir = opts['key-dir'] ? path.resolve(String(opts['key-dir'])) : DEFAULT_KEY_DIR;
  const privatePath = path.join(keyDir, 'skillrig.private.pem');
  const publicPath = opts.public ? path.resolve(String(opts.public)) : DEFAULT_PUBLIC;
  if (fs.existsSync(privatePath) && !opts.force) {
    console.error(`Refusing to overwrite existing signing key: ${privatePath}`);
    console.error('Pass --force to rotate. Rotating invalidates every published signature.');
    process.exit(1);
  }
  const { publicKey, privateKey, keyId } = generateSigningKeyPair();
  ensureDir(keyDir);
  ensureDir(path.dirname(publicPath));
  atomicWriteFile(privatePath, privateKey, { mode: 0o600 });
  atomicWriteFile(publicPath, publicKey, { mode: 0o644 });
  console.log(`Private key: ${privatePath} (mode 0600, never commit this file)`);
  console.log(`Public key:  ${publicPath}`);
  console.log(`Key id:      ${keyId}`);
  console.log('Next: npm run build:registry (signs index.json with this key).');
  return { privatePath, publicPath, keyId };
}

function sign(opts) {
  const indexPath = opts.index ? path.resolve(String(opts.index)) : DEFAULT_INDEX;
  const signaturePath = opts.sig ? path.resolve(String(opts.sig)) : `${indexPath === DEFAULT_INDEX ? DEFAULT_SIG : `${indexPath}.sig`}`;
  const privatePath = opts.key ? path.resolve(String(opts.key)) : DEFAULT_PRIVATE;
  if (!fs.existsSync(privatePath)) {
    console.error(`Signing key not found: ${privatePath}. Run "npm run sign -- --generate" first.`);
    process.exit(1);
  }
  if (!fs.existsSync(indexPath)) {
    console.error(`Registry not found: ${indexPath}. Run "npm run build:registry -- --no-sign" first.`);
    process.exit(1);
  }
  const record = signRegistry({ indexPath, signaturePath, privateKey: privatePath });
  const publicPath = opts.public ? path.resolve(String(opts.public)) : DEFAULT_PUBLIC;
  const pem = fs.readFileSync(privatePath, 'utf8');
  const publicKey = crypto.createPublicKey(pem).export({ type: 'spki', format: 'pem' });
  ensureDir(path.dirname(publicPath));
  fs.writeFileSync(publicPath, publicKey);
  const derived = keyIdFor(publicKey);
  if (derived !== record.keyId) {
    console.error(`Key id mismatch while exporting public key: ${derived} != ${record.keyId}`);
    process.exit(1);
  }
  console.log(`Signed ${path.relative(ROOT, indexPath)} with key ${record.keyId}.`);
  console.log(`Public key: ${path.relative(ROOT, publicPath)}`);
  console.log(`Digest: ${record.digest}`);
}

function check(opts) {
  const indexPath = opts.index ? path.resolve(String(opts.index)) : DEFAULT_INDEX;
  const signaturePath = opts.sig ? path.resolve(String(opts.sig)) : `${indexPath === DEFAULT_INDEX ? DEFAULT_SIG : `${indexPath}.sig`}`;
  const publicPath = opts.public ? path.resolve(String(opts.public)) : DEFAULT_PUBLIC;
  try {
    const result = verifyRegistry({ indexPath, signaturePath, publicKeyPath: publicPath, requireSignature: true });
    console.log(`OK: ${path.relative(ROOT, indexPath)} — key ${result.keyId}, ${result.index.skills?.length ?? 0} skills, ${result.index.packs?.length ?? 0} packs.`);
    console.log(`Signed at ${result.record?.signedAt || 'unknown'}; digest ${result.record?.digest}.`);
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exit(1);
  }
}

const opts = parseArgs(process.argv.slice(2));
if (opts.generate) generate(opts);
else if (opts.check) check(opts);
else sign(opts);
