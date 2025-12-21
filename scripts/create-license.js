#!/usr/bin/env node
const crypto = require('crypto');

const PRIVATE_KEY_PLACEHOLDER = `
-----BEGIN PRIVATE KEY-----
Replace this with your actual private key for production use.
Generate a key pair with: openssl genrsa -out private.pem 2048
                          openssl rsa -in private.pem -pubout -out public.pem
-----END PRIVATE KEY-----
`;

function generateLicenseKey() {
  const segments = [];
  for (let i = 0; i < 4; i++) {
    segments.push(crypto.randomBytes(2).toString('hex').toUpperCase());
  }
  return segments.join('-');
}

function createLicense(fingerprint, tier = 'pro', deviceLimit = null, yearsOfUpdates = 1) {
  const now = new Date();
  const updatesValidUntil = new Date(now.getTime() + yearsOfUpdates * 365 * 24 * 60 * 60 * 1000);
  
  const licenseKey = generateLicenseKey();
  
  const licenseData = {
    licenseKey,
    tier,
    deviceLimit,
    fingerprint,
    purchaseDate: now.toISOString(),
    updatesValidUntil: updatesValidUntil.toISOString(),
  };
  
  const signature = crypto
    .createHash('sha256')
    .update(JSON.stringify(licenseData) + 'YOUR_SECRET_SALT_HERE')
    .digest('hex');
  
  return {
    ...licenseData,
    signature,
  };
}

const args = process.argv.slice(2);

if (args.length < 1) {
  console.log(`
Usage: node create-license.js <fingerprint> [tier] [deviceLimit] [yearsOfUpdates]

Arguments:
  fingerprint      - Server fingerprint (get from Settings > License section)
  tier             - License tier: 'free' or 'pro' (default: 'pro')
  deviceLimit      - Max devices: null for unlimited (default: null)
  yearsOfUpdates   - Years of update entitlement (default: 1)

Example:
  node create-license.js abc123def456 pro null 1
  
Output will be JSON that can be used to activate the license.
`);
  process.exit(1);
}

const fingerprint = args[0];
const tier = args[1] || 'pro';
const deviceLimit = args[2] === 'null' || args[2] === undefined ? null : parseInt(args[2]);
const yearsOfUpdates = parseInt(args[3]) || 1;

const license = createLicense(fingerprint, tier, deviceLimit, yearsOfUpdates);

console.log('\n=== Generated License ===\n');
console.log(JSON.stringify(license, null, 2));
console.log('\n=== Activation Command ===\n');
console.log(`curl -X POST http://localhost:5000/api/license/activate \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(license)}'`);
console.log('\n');
