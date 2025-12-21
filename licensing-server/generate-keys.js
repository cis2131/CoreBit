#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const keysDir = path.join(__dirname, 'keys');

if (!fs.existsSync(keysDir)) {
  fs.mkdirSync(keysDir, { recursive: true, mode: 0o700 });
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
});

const privateKeyPath = path.join(keysDir, 'private.pem');
const publicKeyPath = path.join(keysDir, 'public.pem');

fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });

const adminSecret = crypto.randomBytes(32).toString('hex');

console.log('\n=== RSA Key Pair Generated ===\n');
console.log('Private key: keys/private.pem (permissions: 600 - owner read/write only)');
console.log('Public key:  keys/public.pem');
console.log('');
console.log('=== Generated Admin Secret ===\n');
console.log(`ADMIN_SECRET=${adminSecret}`);
console.log('');
console.log('Add this to your .env file for secure API access.');
console.log('');
console.log('=== Next Steps ===');
console.log('1. Copy the ADMIN_SECRET above to your .env file');
console.log('2. Copy keys/public.pem content to CoreBit server/licensing.ts');
console.log('3. Back up keys/ directory and licenses.db regularly!');
