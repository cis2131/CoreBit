# CoreBit Licensing Server

A standalone licensing server for CoreBit Network Manager with Stripe payment integration.

## Features

- License generation and activation
- RSA signature verification
- Stripe Checkout integration for payments
- Webhook handling for automatic license creation
- SQLite database for license storage

## Quick Start (Ubuntu)

### Option A: Kickstart Installer (Recommended)

```bash
# Copy licensing-server folder to your server, then:
cd licensing-server
sudo ./kickstart.sh

# With Stripe credentials:
sudo ./kickstart.sh \
  --domain licensing.yourdomain.com \
  --stripe-key sk_live_xxxxx \
  --stripe-webhook whsec_xxxxx \
  --stripe-price price_xxxxx
```

### Option B: Manual Installation

#### 1. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### 2. Deploy the Server

```bash
# Create directory
sudo mkdir -p /opt/corebit-licensing
cd /opt/corebit-licensing

# Copy all files from licensing-server/ to this directory
# Then install dependencies
npm install

# Generate RSA keys for signing licenses
npm run generate-keys

# Create environment file
cp .env.example .env
nano .env  # Set ADMIN_SECRET and Stripe credentials
```

#### 3. Create Systemd Service

```bash
sudo nano /etc/systemd/system/corebit-licensing.service
```

Paste:
```ini
[Unit]
Description=CoreBit Licensing Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/corebit-licensing
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable corebit-licensing
sudo systemctl start corebit-licensing
```

### 4. (Optional) Nginx Reverse Proxy with SSL

```bash
sudo apt install nginx certbot python3-certbot-nginx
```

Create config:
```bash
sudo nano /etc/nginx/sites-available/licensing
```

```nginx
server {
    listen 80;
    server_name licensing.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Enable and get SSL:
```bash
sudo ln -s /etc/nginx/sites-available/licensing /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d licensing.yourdomain.com
```

## Stripe Setup

### 1. Create a Stripe Account
Go to https://dashboard.stripe.com and sign up or log in.

### 2. Create a Product and Price
1. Go to **Products** > **Add product**
2. Name: "CoreBit Pro License"
3. Description: "Unlimited devices, 1 year of updates"
4. Price: Your desired amount (e.g., $99.00 USD)
5. Payment type: **One time**
6. Click **Save product**
7. Copy the **Price ID** (starts with `price_`)

### 3. Get Your API Keys
1. Go to **Developers** > **API keys**
2. Copy your **Secret key** (starts with `sk_test_` or `sk_live_`)

### 4. Set Up Webhook
1. Go to **Developers** > **Webhooks**
2. Click **Add endpoint**
3. Endpoint URL: `https://licensing.corebit.ease.dk/webhook`
4. Select events: `checkout.session.completed`
5. Click **Add endpoint**
6. Copy the **Signing secret** (starts with `whsec_`)

### 5. Configure Environment
Add these to your `.env` file:
```bash
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_PRICE_ID=price_xxxxx
BASE_URL=https://licensing.corebit.ease.dk
```

### 6. Restart the Server
```bash
sudo systemctl restart corebit-licensing
```

## Purchase Flow

1. User clicks "Upgrade to Pro" in CoreBit Settings
2. CoreBit calls `/api/stripe/checkout` on this server
3. User is redirected to Stripe Checkout page
4. After payment, Stripe sends webhook to `/webhook`
5. Server creates license and stores it
6. User is redirected to `/success` page with their license key
7. User copies key and activates in CoreBit Settings

## API Usage

### Create a License (Admin)

```bash
curl -X POST https://licensing.yourdomain.com/api/licenses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  -d '{
    "tier": "pro",
    "deviceLimit": null,
    "yearsOfUpdates": 1,
    "customerEmail": "customer@example.com",
    "customerName": "John Doe"
  }'
```

Response:
```json
{
  "success": true,
  "licenseKey": "A1B2-C3D4-E5F6-G7H8",
  "tier": "pro",
  "deviceLimit": null,
  "purchaseDate": "2025-12-21T...",
  "updatesValidUntil": "2026-12-21T..."
}
```

### List All Licenses (Admin)

```bash
curl https://licensing.yourdomain.com/api/licenses \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

### Activate License (from CoreBit)

```bash
curl -X POST https://licensing.yourdomain.com/api/activate \
  -H "Content-Type: application/json" \
  -d '{
    "licenseKey": "A1B2-C3D4-E5F6-G7H8",
    "fingerprint": "server-fingerprint-hash"
  }'
```

Response includes the signed license that CoreBit stores locally.

## Integrating with CoreBit

1. Copy `keys/public.pem` content to CoreBit's `server/licensing.ts`
2. Update CoreBit's activation endpoint to call this server
3. CoreBit stores the signed license locally for offline use

## Backup & Recovery

**Critical files to backup regularly:**
- `keys/private.pem` - Required to sign new licenses (without it, you can't issue new licenses)
- `keys/public.pem` - Embedded in CoreBit for verification
- `licenses.db` - Contains all license records and activation history
- `.env` - Contains your admin secret

Recommended backup approach:
```bash
# Create encrypted backup
tar czf - keys/ licenses.db .env | gpg -c > licensing-backup-$(date +%Y%m%d).tar.gz.gpg

# Restore from backup
gpg -d licensing-backup-*.tar.gz.gpg | tar xzf -
```

## Security Notes

- **Private Key**: `keys/private.pem` is created with 600 permissions (owner read/write only). Never share it or commit to version control.
- **Admin Secret**: Must be at least 32 characters. Generated automatically when running `npm run generate-keys`.
- **HTTPS**: Always use HTTPS in production (via Nginx reverse proxy with Let's Encrypt).
- **Signature Verification**: Licenses are cryptographically signed - they cannot be forged without the private key.
- **Database**: `licenses.db` contains all license data. Back it up regularly to prevent data loss.
