#!/usr/bin/env node
import path from 'node:path';
import { PACKAGE_ROOT } from '../src/core/util.mjs';
import { verifyRegistry } from '../src/core/registry.mjs';

const argv = process.argv.slice(2);
const flag = (name) => {
  const found = argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.split('=').slice(1).join('=') : null;
};

const indexPath = path.resolve(flag('index') || path.join(PACKAGE_ROOT, 'registry', 'index.json'));
const args = { indexPath, requireSignature: true };

try {
  const result = verifyRegistry(args);
  const index = result.index;
  console.log(`Verified registry: ${path.basename(indexPath)}`);
  console.log(`  key:     ${result.keyId}`);
  console.log(`  digest:  ${result.record.digest}`);
  console.log(`  signed:  ${result.record.signedAt}`);
  console.log(`  skills:  ${index.skills?.length ?? 0} (${index.counts?.curated ?? 0} curated, ${index.counts?.upstream ?? 0} upstream)`);
  console.log(`  packs:   ${index.packs?.length ?? 0}`);
  console.log(`  blocked: ${index.counts?.blocked ?? 0}`);
} catch (error) {
  console.error(`Registry verification failed: ${error.message}`);
  process.exit(1);
}
