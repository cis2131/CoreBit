require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const session = require('express-session');
const multer = require('multer');

const app = express();

// Releases storage directory
const RELEASES_DIR = path.join(__dirname, 'releases');
if (!fs.existsSync(RELEASES_DIR)) {
  fs.mkdirSync(RELEASES_DIR, { recursive: true });
}

// Multer configuration for release uploads
const releaseStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const version = req.body.version || 'temp';
    const versionDir = path.join(RELEASES_DIR, version);
    if (!fs.existsSync(versionDir)) {
      fs.mkdirSync(versionDir, { recursive: true });
    }
    cb(null, versionDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const releaseUpload = multer({
  storage: releaseStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.zip', '.tar.gz', '.tgz'];
    const ext = path.extname(file.originalname).toLowerCase();
    const isTarGz = file.originalname.endsWith('.tar.gz');
    if (allowedTypes.includes(ext) || isTarGz) {
      cb(null, true);
    } else {
      cb(new Error('Only .zip, .tar.gz, and .tgz files are allowed'));
    }
  }
});

// Trust reverse proxy (nginx) - required for secure cookies behind HTTPS proxy
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3001;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Admin UI credentials from .env
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  console.warn('WARNING: ADMIN_PASSWORD not set or too short. Admin UI login disabled.');
}

// Stripe configuration (optional - only required for payment processing)
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
let stripe = null;

if (STRIPE_SECRET_KEY) {
  stripe = require('stripe')(STRIPE_SECRET_KEY);
  console.log('Stripe integration enabled');
} else {
  console.log('Stripe not configured - payment endpoints disabled');
}

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
    stripe_session_id TEXT,
    stripe_payment_intent TEXT,
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
  
  CREATE TABLE IF NOT EXISTS releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT UNIQUE NOT NULL,
    channel TEXT DEFAULT 'stable',
    build_date TEXT NOT NULL,
    changelog TEXT,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    min_app_version TEXT,
    is_prerelease INTEGER DEFAULT 0,
    download_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add stripe columns if they don't exist (migration for existing databases)
try {
  db.exec(`ALTER TABLE licenses ADD COLUMN stripe_session_id TEXT`);
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE licenses ADD COLUMN stripe_payment_intent TEXT`);
} catch (e) { /* column already exists */ }

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

function createLicenseFromPayment(customerEmail, customerName, stripeSessionId, stripePaymentIntent) {
  const licenseKey = generateLicenseKey();
  const now = new Date();
  const updatesValidUntil = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year
  
  db.prepare(`
    INSERT INTO licenses (license_key, tier, device_limit, purchase_date, updates_valid_until, customer_email, customer_name, stripe_session_id, stripe_payment_intent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    licenseKey,
    'pro',
    null, // unlimited devices
    now.toISOString(),
    updatesValidUntil.toISOString(),
    customerEmail || null,
    customerName || null,
    stripeSessionId || null,
    stripePaymentIntent || null
  );
  
  return {
    licenseKey,
    tier: 'pro',
    deviceLimit: null,
    purchaseDate: now.toISOString(),
    updatesValidUntil: updatesValidUntil.toISOString(),
  };
}

function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${ADMIN_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Session middleware for admin UI
// Determine if we're behind HTTPS (check BASE_URL or NODE_ENV)
const isHttps = BASE_URL.startsWith('https://') || process.env.NODE_ENV === 'production';

app.use(session({
  name: 'corebit.sid',
  secret: ADMIN_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: isHttps,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));
console.log('Session config: secure=' + isHttps + ', BASE_URL=' + BASE_URL);

// Serve static files for admin UI
app.use(express.static(path.join(__dirname, 'public')));

// CORS for all routes except webhook
app.use((req, res, next) => {
  if (req.path === '/webhook') {
    next();
  } else {
    cors()(req, res, next);
  }
});

// Parse JSON for all routes except webhook (which needs raw body)
app.use((req, res, next) => {
  if (req.path === '/webhook') {
    express.raw({ type: 'application/json' })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

// Admin session authentication middleware
function requireAdminSession(req, res, next) {
  console.log('Session check - ID:', req.sessionID, 'isAdmin:', req.session?.isAdmin);
  if (req.session && req.session.isAdmin) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// ============== STRIPE ENDPOINTS ==============

// Create Stripe Checkout Session
app.post('/api/stripe/checkout', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }
  
  if (!STRIPE_PRICE_ID) {
    return res.status(503).json({ error: 'STRIPE_PRICE_ID not configured' });
  }
  
  try {
    const { fingerprint } = req.body;
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: STRIPE_PRICE_ID,
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/cancel`,
      metadata: {
        fingerprint: fingerprint || '',
      },
    });
    
    res.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Stripe Webhook Handler
app.post('/webhook', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }
  
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET not configured - rejecting webhook');
    return res.status(503).json({ error: 'Webhook secret not configured' });
  }
  
  const sig = req.headers['stripe-signature'];
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    // Check if license already created (idempotency)
    const existing = db.prepare('SELECT * FROM licenses WHERE stripe_session_id = ?').get(session.id);
    if (existing) {
      console.log(`License already exists for session ${session.id}`);
      return res.json({ received: true });
    }
    
    // Create license
    const license = createLicenseFromPayment(
      session.customer_details?.email,
      session.customer_details?.name,
      session.id,
      session.payment_intent
    );
    
    console.log(`License created for session ${session.id}: ${license.licenseKey}`);
  }
  
  res.json({ received: true });
});

// Success page - retrieve license after payment
app.get('/success', async (req, res) => {
  const { session_id } = req.query;
  
  if (!session_id) {
    return res.status(400).send('Session ID required');
  }
  
  // Wait a moment for webhook to process (in case it's slow)
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const license = db.prepare('SELECT * FROM licenses WHERE stripe_session_id = ?').get(session_id);
  
  if (!license) {
    // Try to verify with Stripe and create if payment was successful
    if (stripe) {
      try {
        const session = await stripe.checkout.sessions.retrieve(session_id);
        if (session.payment_status === 'paid') {
          const existing = db.prepare('SELECT * FROM licenses WHERE stripe_session_id = ?').get(session_id);
          if (!existing) {
            const newLicense = createLicenseFromPayment(
              session.customer_details?.email,
              session.customer_details?.name,
              session.id,
              session.payment_intent
            );
            return res.send(generateSuccessPage(newLicense));
          }
        }
      } catch (err) {
        console.error('Error verifying session:', err);
      }
    }
    return res.status(404).send(generateErrorPage('License not found. Please contact support.'));
  }
  
  res.send(generateSuccessPage({
    licenseKey: license.license_key,
    tier: license.tier,
    deviceLimit: license.device_limit,
    purchaseDate: license.purchase_date,
    updatesValidUntil: license.updates_valid_until,
  }));
});

// API endpoint to get license by session ID
app.get('/api/license/session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  
  const license = db.prepare('SELECT * FROM licenses WHERE stripe_session_id = ?').get(sessionId);
  
  if (!license) {
    return res.status(404).json({ error: 'License not found' });
  }
  
  res.json({
    licenseKey: license.license_key,
    tier: license.tier,
    deviceLimit: license.device_limit,
    purchaseDate: license.purchase_date,
    updatesValidUntil: license.updates_valid_until,
    customerEmail: license.customer_email,
  });
});

// Cancel page
app.get('/cancel', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Cancelled - CoreBit</title>
      <style>
        body { font-family: system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
        h1 { color: #f59e0b; }
        a { color: #3b82f6; text-decoration: none; }
      </style>
    </head>
    <body>
      <h1>Payment Cancelled</h1>
      <p>Your payment was cancelled. No charges were made.</p>
      <p><a href="https://corebit.io">Return to CoreBit</a></p>
    </body>
    </html>
  `);
});

function generateSuccessPage(license) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Purchase Complete - CoreBit Pro</title>
      <style>
        body { font-family: system-ui, sans-serif; max-width: 700px; margin: 50px auto; padding: 20px; background: #0f172a; color: #e2e8f0; }
        h1 { color: #22c55e; }
        .license-box { background: #1e293b; border: 2px solid #22c55e; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .license-key { font-size: 24px; font-family: monospace; color: #22c55e; letter-spacing: 2px; text-align: center; padding: 15px; background: #0f172a; border-radius: 4px; margin: 10px 0; }
        .copy-btn { background: #3b82f6; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 16px; }
        .copy-btn:hover { background: #2563eb; }
        .info { color: #94a3b8; margin: 10px 0; }
        .instructions { background: #1e293b; padding: 20px; border-radius: 8px; margin-top: 20px; }
        .instructions h3 { color: #60a5fa; margin-top: 0; }
        .instructions ol { padding-left: 20px; }
        .instructions li { margin: 10px 0; }
        code { background: #0f172a; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
      </style>
    </head>
    <body>
      <h1>Thank You for Your Purchase!</h1>
      
      <div class="license-box">
        <p style="margin: 0 0 10px 0; color: #94a3b8;">Your License Key:</p>
        <div class="license-key" id="licenseKey">${license.licenseKey}</div>
        <div style="text-align: center;">
          <button class="copy-btn" onclick="copyLicense()">Copy License Key</button>
        </div>
        <p class="info">Tier: <strong>Pro</strong> (Unlimited Devices)</p>
        <p class="info">Updates Valid Until: <strong>${new Date(license.updatesValidUntil).toLocaleDateString()}</strong></p>
      </div>
      
      <div class="instructions">
        <h3>How to Activate Your License</h3>
        <ol>
          <li>Open your CoreBit application</li>
          <li>Go to <strong>Settings</strong></li>
          <li>In the License section, click <strong>"Enter License Key"</strong></li>
          <li>Paste your license key: <code>${license.licenseKey}</code></li>
          <li>Click <strong>Activate</strong></li>
        </ol>
        <p style="color: #94a3b8;">Your license is tied to your server once activated. Keep this key safe!</p>
      </div>
      
      <script>
        function copyLicense() {
          navigator.clipboard.writeText('${license.licenseKey}');
          document.querySelector('.copy-btn').textContent = 'Copied!';
          setTimeout(() => {
            document.querySelector('.copy-btn').textContent = 'Copy License Key';
          }, 2000);
        }
      </script>
    </body>
    </html>
  `;
}

function generateErrorPage(message) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Error - CoreBit</title>
      <style>
        body { font-family: system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; background: #0f172a; color: #e2e8f0; }
        h1 { color: #ef4444; }
        a { color: #3b82f6; }
      </style>
    </head>
    <body>
      <h1>Something Went Wrong</h1>
      <p>${message}</p>
      <p>Email: <a href="mailto:support@corebit.io">support@corebit.io</a></p>
    </body>
    </html>
  `;
}

// ============== ADMIN UI ENDPOINTS ==============

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'Admin login not configured' });
  }
  
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    // Explicitly save session before responding
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Session error' });
      }
      console.log('Admin login successful, session ID:', req.sessionID);
      res.json({ success: true });
    });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check admin session
app.get('/api/admin/session', (req, res) => {
  if (req.session && req.session.isAdmin) {
    res.json({ authenticated: true });
  } else {
    res.status(401).json({ authenticated: false });
  }
});

// Admin UI endpoints (session-based auth)
app.get('/api/admin/licenses', requireAdminSession, (req, res) => {
  try {
    const licenses = db.prepare('SELECT * FROM licenses ORDER BY created_at DESC').all();
    res.json(licenses);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch licenses' });
  }
});

app.post('/api/admin/licenses', requireAdminSession, (req, res) => {
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

app.get('/api/admin/licenses/:licenseKey/activations', requireAdminSession, (req, res) => {
  try {
    const { licenseKey } = req.params;
    const activations = db.prepare('SELECT * FROM activations WHERE license_key = ? ORDER BY activated_at DESC').all(licenseKey);
    res.json(activations);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activations' });
  }
});

app.post('/api/admin/licenses/:licenseKey/release', requireAdminSession, (req, res) => {
  try {
    const { licenseKey } = req.params;
    const { reason } = req.body;
    
    const license = db.prepare('SELECT * FROM licenses WHERE license_key = ?').get(licenseKey);
    
    if (!license) {
      return res.status(404).json({ error: 'License not found' });
    }
    
    const oldFingerprint = license.fingerprint;
    
    if (!oldFingerprint) {
      return res.status(400).json({ error: 'License is not currently activated' });
    }
    
    // Clear the fingerprint to allow reactivation
    db.prepare('UPDATE licenses SET fingerprint = NULL, activated_at = NULL WHERE license_key = ?')
      .run(licenseKey);
    
    // Log the release event (audit trail via server logs, not in activations table)
    console.log(`[LICENSE RELEASE] License: ${licenseKey}, Old fingerprint: ${oldFingerprint}, Reason: ${reason || 'Not provided'}, IP: ${req.ip}, Admin UI`);
    
    res.json({
      success: true,
      message: 'License fingerprint released. Customer can now activate on a new server.',
      oldFingerprint,
    });
  } catch (error) {
    console.error('Error releasing license:', error);
    res.status(500).json({ error: 'Failed to release license' });
  }
});

// ============== ADMIN/MANUAL ENDPOINTS (API Key Auth) ==============

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

// Get activation history for a license
app.get('/api/licenses/:licenseKey/activations', requireAdmin, (req, res) => {
  try {
    const { licenseKey } = req.params;
    const activations = db.prepare('SELECT * FROM activations WHERE license_key = ? ORDER BY activated_at DESC').all(licenseKey);
    res.json(activations);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activations' });
  }
});

// Release fingerprint - allows license to be activated on a new server
// Used when customer moves to new hardware or restores from backup
app.post('/api/licenses/:licenseKey/release', requireAdmin, (req, res) => {
  try {
    const { licenseKey } = req.params;
    const { reason } = req.body;
    
    const license = db.prepare('SELECT * FROM licenses WHERE license_key = ?').get(licenseKey);
    
    if (!license) {
      return res.status(404).json({ error: 'License not found' });
    }
    
    const oldFingerprint = license.fingerprint;
    
    if (!oldFingerprint) {
      return res.status(400).json({ error: 'License is not currently activated' });
    }
    
    // Clear the fingerprint to allow reactivation
    db.prepare('UPDATE licenses SET fingerprint = NULL, activated_at = NULL WHERE license_key = ?')
      .run(licenseKey);
    
    // Log the release event (audit trail via server logs, not in activations table)
    console.log(`[LICENSE RELEASE] License: ${licenseKey}, Old fingerprint: ${oldFingerprint}, Reason: ${reason || 'Not provided'}, IP: ${req.ip}, API`);
    
    res.json({
      success: true,
      message: `License fingerprint released. Customer can now activate on a new server.`,
      oldFingerprint,
    });
  } catch (error) {
    console.error('Error releasing license:', error);
    res.status(500).json({ error: 'Failed to release license' });
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

// ============== RELEASE MANAGEMENT ENDPOINTS ==============

// Helper function to compute SHA256 of a file
function computeFileSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

// Helper to generate signed download token
function generateDownloadToken(version, licenseKey) {
  const data = JSON.stringify({ version, licenseKey, exp: Date.now() + 3600000 }); // 1 hour expiry
  const hmac = crypto.createHmac('sha256', ADMIN_SECRET);
  hmac.update(data);
  const signature = hmac.digest('hex');
  return Buffer.from(JSON.stringify({ data, signature })).toString('base64');
}

// Helper to verify download token
function verifyDownloadToken(token) {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
    const { data, signature } = decoded;
    const hmac = crypto.createHmac('sha256', ADMIN_SECRET);
    hmac.update(data);
    const expectedSig = hmac.digest('hex');
    if (signature !== expectedSig) return null;
    
    const payload = JSON.parse(data);
    if (payload.exp < Date.now()) return null;
    
    return payload;
  } catch (e) {
    return null;
  }
}

// List all releases (admin)
app.get('/api/admin/releases', requireAdminSession, (req, res) => {
  try {
    const releases = db.prepare('SELECT * FROM releases ORDER BY build_date DESC').all();
    res.json(releases);
  } catch (error) {
    console.error('Error fetching releases:', error);
    res.status(500).json({ error: 'Failed to fetch releases' });
  }
});

// Upload new release (admin)
app.post('/api/admin/releases', requireAdminSession, releaseUpload.single('file'), (req, res) => {
  try {
    const { version, channel = 'stable', changelog, buildDate, minAppVersion, isPrerelease } = req.body;
    
    if (!version || !req.file) {
      // Clean up temp file if exists
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Version and file are required' });
    }
    
    // Check if version already exists
    const existing = db.prepare('SELECT id FROM releases WHERE version = ?').get(version);
    if (existing) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Version already exists' });
    }
    
    // Compute SHA256
    const sha256 = computeFileSha256(req.file.path);
    
    // Move file to correct directory (in case version was different from temp)
    const versionDir = path.join(RELEASES_DIR, version);
    if (!fs.existsSync(versionDir)) {
      fs.mkdirSync(versionDir, { recursive: true });
    }
    const finalPath = path.join(versionDir, req.file.originalname);
    if (req.file.path !== finalPath) {
      fs.renameSync(req.file.path, finalPath);
    }
    
    const stmt = db.prepare(`
      INSERT INTO releases (version, channel, build_date, changelog, file_name, file_path, file_size_bytes, sha256, min_app_version, is_prerelease)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      version,
      channel,
      buildDate || new Date().toISOString(),
      changelog || null,
      req.file.originalname,
      finalPath,
      req.file.size,
      sha256,
      minAppVersion || null,
      isPrerelease === 'true' || isPrerelease === true ? 1 : 0
    );
    
    console.log(`[RELEASE] New release uploaded: ${version} (${req.file.originalname})`);
    
    res.json({
      success: true,
      version,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      sha256
    });
  } catch (error) {
    console.error('Error uploading release:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Failed to upload release' });
  }
});

// Delete release (admin)
app.delete('/api/admin/releases/:version', requireAdminSession, (req, res) => {
  try {
    const { version } = req.params;
    
    const release = db.prepare('SELECT * FROM releases WHERE version = ?').get(version);
    if (!release) {
      return res.status(404).json({ error: 'Release not found' });
    }
    
    // Delete file
    if (fs.existsSync(release.file_path)) {
      fs.unlinkSync(release.file_path);
    }
    
    // Delete version directory if empty
    const versionDir = path.dirname(release.file_path);
    try {
      fs.rmdirSync(versionDir);
    } catch (e) { /* Directory not empty or doesn't exist */ }
    
    // Delete from database
    db.prepare('DELETE FROM releases WHERE version = ?').run(version);
    
    console.log(`[RELEASE] Release deleted: ${version}`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting release:', error);
    res.status(500).json({ error: 'Failed to delete release' });
  }
});

// ============== PUBLIC RELEASE ENDPOINTS ==============

// Check for updates (public - used by CoreBit installations)
app.post('/api/releases/check', (req, res) => {
  try {
    const { licenseKey, fingerprint, currentVersion, channel = 'stable' } = req.body;
    
    // Get latest release for the channel
    const latestRelease = db.prepare(`
      SELECT * FROM releases 
      WHERE channel = ? AND is_prerelease = 0
      ORDER BY build_date DESC 
      LIMIT 1
    `).get(channel);
    
    if (!latestRelease) {
      return res.json({
        updateAvailable: false,
        message: 'No releases available'
      });
    }
    
    // Compare versions (simple string comparison - assumes semver)
    const isNewer = latestRelease.version !== currentVersion;
    
    // Determine entitlement status
    let status = 'allowed';
    let reason = null;
    let downloadToken = null;
    
    if (licenseKey && fingerprint) {
      const license = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND fingerprint = ?').get(licenseKey, fingerprint);
      
      if (license) {
        const releaseBuildDate = new Date(latestRelease.build_date);
        const entitlementExpiry = new Date(license.updates_valid_until);
        
        if (license.tier === 'free') {
          // Free tier always allowed
          status = 'allowed';
          downloadToken = generateDownloadToken(latestRelease.version, licenseKey);
        } else if (releaseBuildDate <= entitlementExpiry) {
          // Pro tier with valid entitlement
          status = 'allowed';
          downloadToken = generateDownloadToken(latestRelease.version, licenseKey);
        } else {
          // Pro tier with expired entitlement
          status = 'warning';
          reason = `Your update entitlement expired on ${entitlementExpiry.toLocaleDateString()}. Installing this update will revert your installation to read-only mode (Free tier). Consider renewing your Pro license to maintain full functionality.`;
          // Still provide token but with warning
          downloadToken = generateDownloadToken(latestRelease.version, licenseKey);
        }
      } else {
        // Invalid or unactivated license
        status = 'allowed';
        reason = 'No valid license detected. Updates are available but the installation will operate in Free tier mode.';
        downloadToken = generateDownloadToken(latestRelease.version, 'anonymous');
      }
    } else {
      // No license provided - anonymous update check
      status = 'allowed';
      downloadToken = generateDownloadToken(latestRelease.version, 'anonymous');
    }
    
    res.json({
      updateAvailable: isNewer,
      currentVersion,
      latestVersion: latestRelease.version,
      buildDate: latestRelease.build_date,
      changelog: latestRelease.changelog,
      fileSize: latestRelease.file_size_bytes,
      sha256: latestRelease.sha256,
      status,
      reason,
      downloadToken: isNewer ? downloadToken : null,
      downloadUrl: isNewer ? `${BASE_URL}/api/releases/${latestRelease.version}/download` : null
    });
  } catch (error) {
    console.error('Error checking for updates:', error);
    res.status(500).json({ error: 'Failed to check for updates' });
  }
});

// Get latest release info (public)
app.get('/api/releases/latest', (req, res) => {
  try {
    const { channel = 'stable' } = req.query;
    
    const release = db.prepare(`
      SELECT version, channel, build_date, changelog, file_name, file_size_bytes, sha256 
      FROM releases 
      WHERE channel = ? AND is_prerelease = 0
      ORDER BY build_date DESC 
      LIMIT 1
    `).get(channel);
    
    if (!release) {
      return res.status(404).json({ error: 'No releases available' });
    }
    
    res.json({
      ...release,
      downloadUrl: `${BASE_URL}/api/releases/${release.version}/download`
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get latest release' });
  }
});

// Download release file (requires token or admin session)
app.get('/api/releases/:version/download', (req, res) => {
  try {
    const { version } = req.params;
    const { token } = req.query;
    
    // Check if admin session or valid token
    const isAdmin = req.session && req.session.isAdmin;
    let tokenPayload = null;
    
    if (!isAdmin) {
      if (!token) {
        return res.status(401).json({ error: 'Download token required' });
      }
      tokenPayload = verifyDownloadToken(token);
      if (!tokenPayload || tokenPayload.version !== version) {
        return res.status(401).json({ error: 'Invalid or expired download token' });
      }
    }
    
    const release = db.prepare('SELECT * FROM releases WHERE version = ?').get(version);
    if (!release) {
      return res.status(404).json({ error: 'Release not found' });
    }
    
    if (!fs.existsSync(release.file_path)) {
      return res.status(404).json({ error: 'Release file not found' });
    }
    
    // Increment download count
    db.prepare('UPDATE releases SET download_count = download_count + 1 WHERE version = ?').run(version);
    
    // Log download
    console.log(`[DOWNLOAD] Release ${version} downloaded by ${tokenPayload?.licenseKey || 'admin'}`);
    
    // Stream the file
    res.setHeader('Content-Disposition', `attachment; filename="${release.file_name}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', release.file_size_bytes);
    res.setHeader('X-Checksum-SHA256', release.sha256);
    
    const fileStream = fs.createReadStream(release.file_path);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Error downloading release:', error);
    res.status(500).json({ error: 'Failed to download release' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', stripe: !!stripe });
});

app.listen(PORT, () => {
  console.log(`CoreBit Licensing Server running on port ${PORT}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Admin API: POST /api/licenses (requires Authorization header)`);
  console.log(`Activation: POST /api/activate`);
  if (stripe) {
    console.log(`Stripe Checkout: POST /api/stripe/checkout`);
    console.log(`Stripe Webhook: POST /webhook`);
  }
});
