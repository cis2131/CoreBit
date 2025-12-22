require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const session = require('express-session');

const app = express();

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
