require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET || ADMIN_SECRET === 'change-this-secret' || ADMIN_SECRET.length < 32) {
  console.error('ERROR: ADMIN_SECRET must be set in .env and be at least 32 characters.');
  console.error('Run "npm run generate-keys" to generate a secure secret.');
  process.exit(1);
}

const privateKeyPath = path.join(__dirname, 'keys', 'private.pem');
if (!fs.existsSync(privateKeyPath)) {
  console.error('ERROR: Private key not found. Run "npm run generate-keys" first.');
  process.exit(1);
}
const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

const db = new Database(path.join(__dirname, 'licenses.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT UNIQUE NOT NULL,
    fingerprint TEXT,
    tier TEXT NOT NULL DEFAULT 'pro',
    device_limit INTEGER,
    purchase_date TEXT NOT NULL,
    updates_valid_until TEXT NOT NULL,
    activated_at TEXT,
    customer_email TEXT,
    customer_name TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS activations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    activated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    FOREIGN KEY (license_key) REFERENCES licenses(license_key)
  );
`);

function generateLicenseKey() {
  const segments = [];
  for (let i = 0; i < 4; i++) {
    segments.push(crypto.randomBytes(2).toString('hex').toUpperCase());
  }
  return segments.join('-');
}

function signLicense(licenseData) {
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

function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${ADMIN_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.post('/api/licenses', requireAdmin, (req, res) => {
  try {
    const { tier = 'pro', deviceLimit = null, yearsOfUpdates = 1, customerEmail, customerName, notes } = req.body;
    
    const licenseKey = generateLicenseKey();
    const now = new Date();
    const updatesValidUntil = new Date(now.getTime() + yearsOfUpdates * 365 * 24 * 60 * 60 * 1000);
    
    const stmt = db.prepare(`
      INSERT INTO licenses (license_key, tier, device_limit, purchase_date, updates_valid_until, customer_email, customer_name, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      licenseKey,
      tier,
      deviceLimit,
      now.toISOString(),
      updatesValidUntil.toISOString(),
      customerEmail || null,
      customerName || null,
      notes || null
    );
    
    res.json({
      success: true,
      licenseKey,
      tier,
      deviceLimit,
      purchaseDate: now.toISOString(),
      updatesValidUntil: updatesValidUntil.toISOString(),
    });
  } catch (error) {
    console.error('Error creating license:', error);
    res.status(500).json({ error: 'Failed to create license' });
  }
});

app.get('/api/licenses', requireAdmin, (req, res) => {
  try {
    const licenses = db.prepare('SELECT * FROM licenses ORDER BY created_at DESC').all();
    res.json(licenses);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch licenses' });
  }
});

app.post('/api/activate', (req, res) => {
  try {
    const { licenseKey, fingerprint } = req.body;
    
    if (!licenseKey || !fingerprint) {
      return res.status(400).json({ error: 'License key and fingerprint required' });
    }
    
    const license = db.prepare('SELECT * FROM licenses WHERE license_key = ?').get(licenseKey);
    
    if (!license) {
      return res.status(404).json({ error: 'Invalid license key' });
    }
    
    if (license.fingerprint && license.fingerprint !== fingerprint) {
      return res.status(400).json({ error: 'License already activated on a different server' });
    }
    
    if (!license.fingerprint) {
      db.prepare('UPDATE licenses SET fingerprint = ?, activated_at = ? WHERE license_key = ?')
        .run(fingerprint, new Date().toISOString(), licenseKey);
    }
    
    db.prepare('INSERT INTO activations (license_key, fingerprint, ip_address) VALUES (?, ?, ?)')
      .run(licenseKey, fingerprint, req.ip);
    
    const licenseData = {
      licenseKey: license.license_key,
      tier: license.tier,
      deviceLimit: license.device_limit,
      fingerprint: fingerprint,
      purchaseDate: license.purchase_date,
      updatesValidUntil: license.updates_valid_until,
    };
    
    const signature = signLicense(licenseData);
    
    res.json({
      success: true,
      license: {
        ...licenseData,
        signature,
      }
    });
  } catch (error) {
    console.error('Error activating license:', error);
    res.status(500).json({ error: 'Failed to activate license' });
  }
});

app.get('/api/validate', (req, res) => {
  try {
    const { licenseKey, fingerprint } = req.query;
    
    const license = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND fingerprint = ?').get(licenseKey, fingerprint);
    
    if (!license) {
      return res.json({ valid: false });
    }
    
    res.json({
      valid: true,
      tier: license.tier,
      deviceLimit: license.device_limit,
      updatesValidUntil: license.updates_valid_until,
    });
  } catch (error) {
    res.status(500).json({ error: 'Validation failed' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`CoreBit Licensing Server running on port ${PORT}`);
  console.log(`Admin API: POST /api/licenses (requires Authorization header)`);
  console.log(`Activation: POST /api/activate`);
});
