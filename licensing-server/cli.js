#!/usr/bin/env node
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'licenses.db'));

const privateKeyPath = path.join(__dirname, 'keys', 'private.pem');

function generateLicenseKey() {
  const segments = [];
  for (let i = 0; i < 4; i++) {
    segments.push(crypto.randomBytes(2).toString('hex').toUpperCase());
  }
  return segments.join('-');
}

function signLicense(licenseData) {
  if (!fs.existsSync(privateKeyPath)) {
    console.error('ERROR: Run "npm run generate-keys" first');
    process.exit(1);
  }
  const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
  const dataToSign = JSON.stringify({
    licenseKey: licenseData.licenseKey,
    tier: licenseData.tier,
    deviceLimit: licenseData.deviceLimit,
    fingerprint: licenseData.fingerprint,
    purchaseDate: licenseData.purchaseDate,
    updatesValidUntil: licenseData.updatesValidUntil,
  });
  
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(dataToSign);
  return sign.sign(privateKey, 'base64');
}

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'create': {
    const tier = args[1] || 'pro';
    const deviceLimit = args[2] === 'null' || args[2] === undefined ? null : parseInt(args[2]);
    const yearsOfUpdates = parseInt(args[3]) || 1;
    const customerEmail = args[4] || null;
    
    const licenseKey = generateLicenseKey();
    const now = new Date();
    const updatesValidUntil = new Date(now.getTime() + yearsOfUpdates * 365 * 24 * 60 * 60 * 1000);
    
    db.prepare(`
      INSERT INTO licenses (license_key, tier, device_limit, purchase_date, updates_valid_until, customer_email)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(licenseKey, tier, deviceLimit, now.toISOString(), updatesValidUntil.toISOString(), customerEmail);
    
    console.log('\n=== License Created ===');
    console.log(`License Key: ${licenseKey}`);
    console.log(`Tier: ${tier}`);
    console.log(`Device Limit: ${deviceLimit || 'Unlimited'}`);
    console.log(`Updates Valid Until: ${updatesValidUntil.toISOString().split('T')[0]}`);
    console.log('\nShare this license key with your customer.');
    break;
  }
  
  case 'list': {
    const licenses = db.prepare('SELECT * FROM licenses ORDER BY created_at DESC LIMIT 20').all();
    console.log('\n=== Recent Licenses ===\n');
    if (licenses.length === 0) {
      console.log('No licenses found.');
    } else {
      licenses.forEach(l => {
        const status = l.fingerprint ? 'ACTIVATED' : 'NOT ACTIVATED';
        console.log(`${l.license_key} | ${l.tier.toUpperCase()} | ${status} | ${l.customer_email || 'N/A'}`);
      });
    }
    break;
  }
  
  case 'activate': {
    const licenseKey = args[1];
    const fingerprint = args[2];
    
    if (!licenseKey || !fingerprint) {
      console.error('Usage: node cli.js activate <license-key> <fingerprint>');
      process.exit(1);
    }
    
    const license = db.prepare('SELECT * FROM licenses WHERE license_key = ?').get(licenseKey);
    
    if (!license) {
      console.error('License not found');
      process.exit(1);
    }
    
    if (license.fingerprint && license.fingerprint !== fingerprint) {
      console.error('License already activated on different server');
      process.exit(1);
    }
    
    if (!license.fingerprint) {
      db.prepare('UPDATE licenses SET fingerprint = ?, activated_at = ? WHERE license_key = ?')
        .run(fingerprint, new Date().toISOString(), licenseKey);
    }
    
    const licenseData = {
      licenseKey: license.license_key,
      tier: license.tier,
      deviceLimit: license.device_limit,
      fingerprint: fingerprint,
      purchaseDate: license.purchase_date,
      updatesValidUntil: license.updates_valid_until,
    };
    
    const signature = signLicense(licenseData);
    
    console.log('\n=== Signed License (copy entire JSON to CoreBit) ===\n');
    console.log(JSON.stringify({ ...licenseData, signature }, null, 2));
    break;
  }
  
  case 'info': {
    const licenseKey = args[1];
    if (!licenseKey) {
      console.error('Usage: node cli.js info <license-key>');
      process.exit(1);
    }
    
    const license = db.prepare('SELECT * FROM licenses WHERE license_key = ?').get(licenseKey);
    if (!license) {
      console.error('License not found');
      process.exit(1);
    }
    
    console.log('\n=== License Info ===\n');
    console.log(`Key: ${license.license_key}`);
    console.log(`Tier: ${license.tier}`);
    console.log(`Device Limit: ${license.device_limit || 'Unlimited'}`);
    console.log(`Purchase Date: ${license.purchase_date}`);
    console.log(`Updates Valid Until: ${license.updates_valid_until}`);
    console.log(`Status: ${license.fingerprint ? 'ACTIVATED' : 'NOT ACTIVATED'}`);
    if (license.fingerprint) {
      console.log(`Server Fingerprint: ${license.fingerprint}`);
      console.log(`Activated At: ${license.activated_at}`);
    }
    console.log(`Customer: ${license.customer_email || 'N/A'}`);
    break;
  }
  
  default:
    console.log(`
CoreBit License Manager CLI

Commands:
  create [tier] [deviceLimit] [years] [email]
    Create a new license
    - tier: 'free' or 'pro' (default: pro)
    - deviceLimit: number or 'null' for unlimited
    - years: years of update entitlement (default: 1)
    - email: customer email (optional)
    
    Example: node cli.js create pro null 1 customer@example.com

  list
    List recent licenses
    
  info <license-key>
    Show details for a specific license
    
  activate <license-key> <fingerprint>
    Manually activate and get signed license JSON
    (Fingerprint is shown in CoreBit Settings > License section)
    
    Example: node cli.js activate A1B2-C3D4-E5F6-G7H8 abc123def456
`);
}
