# Network Topology Manager - Ubuntu Deployment Guide

Complete guide for deploying The Dude network management application on Ubuntu 22.04+ in production.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [System Setup](#system-setup)
3. [PostgreSQL Configuration](#postgresql-configuration)
4. [Application Setup](#application-setup)
5. [PM2 Process Management](#pm2-process-management)
6. [Nginx Reverse Proxy](#nginx-reverse-proxy)
7. [SSL/HTTPS Setup](#ssl-https-setup)
8. [Security Hardening](#security-hardening)
9. [Deployment Workflow](#deployment-workflow)
10. [Monitoring & Maintenance](#monitoring--maintenance)
11. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- Ubuntu 22.04 LTS or newer
- Root or sudo access
- Domain name (optional, required for SSL)
- Minimum 2GB RAM, 2 CPU cores
- 20GB disk space

---

## System Setup

### 1. Update System Packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install git curl build-essential -y
```

### 2. Install Node.js (via NVM - Recommended)

```bash
# Install NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc

# Install Node.js 20 LTS
nvm install 20
nvm use 20
nvm alias default 20

# Verify installation
node --version  # Should show v20.x.x
npm --version   # Should show 10.x.x
```

### 3. Create Application User (Security Best Practice)

```bash
# Create dedicated user for the application
sudo adduser --system --group --home /opt/network-topology networkapp

# Add current user to the group (optional, for easier management)
sudo usermod -aG networkapp $USER
```

---

## PostgreSQL Configuration

### 1. Install PostgreSQL

```bash
sudo apt install postgresql postgresql-contrib -y
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### 2. Create Database and User

```bash
# Switch to postgres user
sudo -u postgres psql

# In PostgreSQL prompt, run:
CREATE DATABASE network_topology;
CREATE USER netapp WITH PASSWORD 'your_secure_password_here';
GRANT ALL PRIVILEGES ON DATABASE network_topology TO netapp;

# Grant schema permissions (PostgreSQL 15+)
\c network_topology
GRANT ALL ON SCHEMA public TO netapp;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO netapp;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO netapp;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO netapp;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO netapp;

\q
```

### 3. Configure PostgreSQL for Local Connections

Edit PostgreSQL config to allow password authentication:

```bash
sudo nano /etc/postgresql/15/main/pg_hba.conf
```

Change the following line:
```
# From:
local   all             all                                     peer

# To:
local   all             all                                     md5
```

Restart PostgreSQL:
```bash
sudo systemctl restart postgresql
```

### 4. Test Database Connection

```bash
psql -U netapp -d network_topology -h localhost -W
# Enter your password when prompted
# Type \q to exit
```

---

## Application Setup

### 1. Clone Repository

```bash
# Create application directory
sudo mkdir -p /opt/network-topology
sudo chown networkapp:networkapp /opt/network-topology

# Clone your repository (replace with your repo URL)
sudo -u networkapp git clone https://github.com/yourusername/network-topology.git /opt/network-topology

cd /opt/network-topology
```

### 2. Install Dependencies

```bash
# Install all dependencies (dotenv is required for production)
sudo -u networkapp npm ci
```

**Note:** The application uses `dotenv` package to load environment variables from the `.env` file, so all dependencies must be installed (not just production dependencies).

### 3. Configure Environment Variables

Create production environment file:

```bash
sudo -u networkapp nano /opt/network-topology/.env
```

Add the following configuration:

```env
# Node Environment
NODE_ENV=production

# Server Configuration
PORT=5000
HOST=0.0.0.0

# Database Connection
DATABASE_URL=postgresql://netapp:your_secure_password_here@localhost:5432/network_topology
PGHOST=localhost
PGPORT=5432
PGUSER=netapp
PGPASSWORD=your_secure_password_here
PGDATABASE=network_topology

# Session Secret (generate a strong random string)
SESSION_SECRET=your_long_random_session_secret_here_min_32_chars

# Optional: Application Settings
POLLING_INTERVAL=30000
FRONTEND_POLLING_INTERVAL=10000
```

**Generate a secure session secret:**
```bash
openssl rand -base64 32
```

### 4. Run Database Migrations

```bash
cd /opt/network-topology
sudo -u networkapp npm run db:push
```

### 5. Build Frontend (if needed)

If your setup requires a build step:
```bash
sudo -u networkapp npm run build
```

### 6. Test Application

```bash
sudo -u networkapp npm start
# Application should start on port 5000
# Press Ctrl+C to stop
```

---

## PM2 Process Management

### 1. Install PM2 Globally

```bash
sudo npm install -g pm2
```

### 2. Create PM2 Ecosystem File

Create `ecosystem.config.js` in the application directory:

```bash
sudo -u networkapp nano /opt/network-topology/ecosystem.config.js
```

Add the following configuration:

```javascript
module.exports = {
  apps: [{
    name: 'network-topology',
    script: './server/index.ts',
    interpreter: 'node',
    interpreter_args: '--require tsx/cjs',
    instances: 2,  // Adjust based on CPU cores (or use 'max')
    exec_mode: 'cluster',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env_production: {
      NODE_ENV: 'production',
      PORT: 5000,
      HOST: '0.0.0.0'
    },
    error_file: '/opt/network-topology/logs/err.log',
    out_file: '/opt/network-topology/logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000
  }]
};
```

### 3. Create Logs Directory

```bash
sudo -u networkapp mkdir -p /opt/network-topology/logs
```

### 4. Start Application with PM2

```bash
cd /opt/network-topology

# Start as networkapp user
sudo -u networkapp pm2 start ecosystem.config.js --env production

# Check status
sudo -u networkapp pm2 status
sudo -u networkapp pm2 logs network-topology --lines 50

# Save PM2 process list
sudo -u networkapp pm2 save
```

### 5. Configure PM2 Startup Script

Generate startup script to auto-start on boot:

```bash
# Generate startup script
sudo -u networkapp pm2 startup systemd -u networkapp --hp /opt/network-topology

# PM2 will output a command like this - copy and run it:
# sudo env PATH=$PATH:/home/username/.nvm/versions/node/v20.x.x/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u networkapp --hp /opt/network-topology

# Save the PM2 process list
sudo -u networkapp pm2 save
```

### 6. Install PM2 Log Rotation

```bash
sudo -u networkapp pm2 install pm2-logrotate

# Configure log rotation
sudo -u networkapp pm2 set pm2-logrotate:max_size 10M
sudo -u networkapp pm2 set pm2-logrotate:retain 14
sudo -u networkapp pm2 set pm2-logrotate:compress true
```

---

## Nginx Reverse Proxy

### 1. Install Nginx

```bash
sudo apt install nginx -y
sudo systemctl start nginx
sudo systemctl enable nginx
```

### 2. Configure Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

### 3. Create Nginx Configuration

```bash
sudo nano /etc/nginx/sites-available/network-topology
```

Add the following configuration:

```nginx
# Upstream configuration for Node.js app
upstream network_topology_app {
    least_conn;
    server 127.0.0.1:5000 max_fails=3 fail_timeout=30s;
    keepalive 64;
}

server {
    listen 80;
    listen [::]:80;
    server_name your-domain.com www.your-domain.com;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Logging
    access_log /var/log/nginx/network-topology-access.log;
    error_log /var/log/nginx/network-topology-error.log;

    # Client body size limit (for file uploads)
    client_max_body_size 10M;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss text/javascript;

    # Main application
    location / {
        proxy_pass http://network_topology_app;
        proxy_http_version 1.1;
        
        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        
        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Buffering
        proxy_buffering off;
        proxy_cache_bypass $http_upgrade;
    }

    # Static files caching (if applicable)
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://network_topology_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://network_topology_app;
        access_log off;
    }
}
```

### 4. Enable Site and Test Configuration

```bash
# Create symbolic link to enable site
sudo ln -s /etc/nginx/sites-available/network-topology /etc/nginx/sites-enabled/

# Remove default site (optional)
sudo rm /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# If test passes, reload Nginx
sudo systemctl reload nginx
```

---

## SSL/HTTPS Setup

### 1. Install Certbot

```bash
sudo apt install certbot python3-certbot-nginx -y
```

### 2. Obtain SSL Certificate

```bash
# Replace with your actual domain
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

Follow the prompts:
- Enter email address
- Agree to terms
- Choose whether to redirect HTTP to HTTPS (recommended: yes)

### 3. Verify Auto-Renewal

```bash
# Test renewal process
sudo certbot renew --dry-run

# Check renewal timer
sudo systemctl status certbot.timer
```

Certbot will automatically renew certificates before expiration.

---

## Security Hardening

### 1. Configure Firewall Rules

```bash
# Allow only necessary ports
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

### 2. Disable Root SSH Login

```bash
sudo nano /etc/ssh/sshd_config
```

Set the following:
```
PermitRootLogin no
PasswordAuthentication no  # If using SSH keys
```

Restart SSH:
```bash
sudo systemctl restart sshd
```

### 3. Install Fail2Ban

```bash
sudo apt install fail2ban -y
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

### 4. Set Proper File Permissions

```bash
sudo chown -R networkapp:networkapp /opt/network-topology
sudo chmod 750 /opt/network-topology
sudo chmod 600 /opt/network-topology/.env
```

### 5. Enable Automatic Security Updates

```bash
sudo apt install unattended-upgrades -y
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

---

## Deployment Workflow

### Manual Deployment

Create a deployment script:

```bash
sudo nano /opt/network-topology/deploy.sh
```

```bash
#!/bin/bash
set -e

echo "🚀 Starting deployment..."

# Navigate to app directory
cd /opt/network-topology

# Pull latest changes
echo "📥 Pulling latest code..."
sudo -u networkapp git pull origin main

# Install dependencies
echo "📦 Installing dependencies..."
sudo -u networkapp npm ci

# Run database migrations
echo "🗄️  Running migrations..."
sudo -u networkapp npm run db:push

# Reload PM2
echo "♻️  Reloading application..."
sudo -u networkapp pm2 reload ecosystem.config.js --env production

echo "✅ Deployment complete!"
```

Make it executable:
```bash
sudo chmod +x /opt/network-topology/deploy.sh
```

Run deployment:
```bash
sudo /opt/network-topology/deploy.sh
```

### Automated Deployment with GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1.0.0
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /opt/network-topology
            sudo -u networkapp git pull origin main
            sudo -u networkapp npm ci
            sudo -u networkapp npm run db:push
            sudo -u networkapp pm2 reload ecosystem.config.js --env production
```

Add secrets in GitHub repository settings:
- `SERVER_HOST`: Your server IP or domain
- `SERVER_USER`: SSH username
- `SSH_PRIVATE_KEY`: Private SSH key for authentication

---

## Monitoring & Maintenance

### PM2 Monitoring

```bash
# Real-time monitoring
sudo -u networkapp pm2 monit

# Process status
sudo -u networkapp pm2 status

# View logs
sudo -u networkapp pm2 logs network-topology

# Show detailed info
sudo -u networkapp pm2 show network-topology
```

### Nginx Monitoring

```bash
# Check status
sudo systemctl status nginx

# View access logs
sudo tail -f /var/log/nginx/network-topology-access.log

# View error logs
sudo tail -f /var/log/nginx/network-topology-error.log
```

### Database Monitoring

```bash
# Connect to database
psql -U netapp -d network_topology -h localhost

# Check connections
SELECT count(*) FROM pg_stat_activity;

# Database size
SELECT pg_size_pretty(pg_database_size('network_topology'));
```

### System Resource Monitoring

```bash
# Install htop
sudo apt install htop -y
htop

# Check disk usage
df -h

# Check memory
free -h
```

### Backup Script

Create automated backup:

```bash
sudo nano /opt/backup-db.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/opt/backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup database
PGPASSWORD="your_secure_password_here" pg_dump -U netapp -h localhost network_topology | gzip > $BACKUP_DIR/db_backup_$DATE.sql.gz

# Keep only last 7 days of backups
find $BACKUP_DIR -name "db_backup_*.sql.gz" -mtime +7 -delete

echo "Backup completed: db_backup_$DATE.sql.gz"
```

Make executable and add to cron:
```bash
sudo chmod +x /opt/backup-db.sh

# Add to crontab (daily at 2 AM)
sudo crontab -e
# Add line:
0 2 * * * /opt/backup-db.sh
```

---

## Troubleshooting

### Application Won't Start

```bash
# Check PM2 logs
sudo -u networkapp pm2 logs network-topology --lines 100

# Check if port is in use
sudo netstat -tlnp | grep :5000

# Restart application
sudo -u networkapp pm2 restart network-topology
```

### Database Connection Issues

```bash
# Test database connection
psql -U netapp -d network_topology -h localhost -W

# Check PostgreSQL is running
sudo systemctl status postgresql

# View PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-15-main.log
```

### Nginx Issues

```bash
# Test configuration
sudo nginx -t

# Check Nginx status
sudo systemctl status nginx

# Restart Nginx
sudo systemctl restart nginx

# Check error logs
sudo tail -f /var/log/nginx/error.log
```

### SSL Certificate Issues

```bash
# Check certificate status
sudo certbot certificates

# Renew manually
sudo certbot renew

# Check renewal timer
sudo systemctl status certbot.timer
```

### High Memory Usage

```bash
# Check PM2 processes
sudo -u networkapp pm2 status

# Reduce PM2 instances in ecosystem.config.js
# Change instances: 2 to instances: 1

# Reload PM2
sudo -u networkapp pm2 reload ecosystem.config.js
```

### View All Logs

```bash
# Application logs
sudo -u networkapp pm2 logs network-topology

# Nginx access logs
sudo tail -f /var/log/nginx/network-topology-access.log

# Nginx error logs
sudo tail -f /var/log/nginx/network-topology-error.log

# System logs
sudo journalctl -u nginx -f
sudo journalctl -xe
```

---

## Quick Reference Commands

| Task | Command |
|------|---------|
| Start app | `sudo -u networkapp pm2 start ecosystem.config.js --env production` |
| Stop app | `sudo -u networkapp pm2 stop network-topology` |
| Restart app | `sudo -u networkapp pm2 restart network-topology` |
| Reload app (zero-downtime) | `sudo -u networkapp pm2 reload network-topology` |
| View logs | `sudo -u networkapp pm2 logs network-topology` |
| Monitor app | `sudo -u networkapp pm2 monit` |
| App status | `sudo -u networkapp pm2 status` |
| Test Nginx | `sudo nginx -t` |
| Reload Nginx | `sudo systemctl reload nginx` |
| Restart Nginx | `sudo systemctl restart nginx` |
| Renew SSL | `sudo certbot renew` |
| Database backup | `sudo /opt/backup-db.sh` |
| Deploy updates | `sudo /opt/network-topology/deploy.sh` |

---

## Production Checklist

Before going live, ensure:

- [ ] PostgreSQL database created and accessible
- [ ] Environment variables configured in `.env`
- [ ] Database migrations run successfully
- [ ] PM2 process manager configured and running
- [ ] PM2 startup script configured for auto-start
- [ ] Nginx reverse proxy configured
- [ ] SSL certificate installed and auto-renewal enabled
- [ ] Firewall configured (UFW)
- [ ] Application user created with limited permissions
- [ ] Log rotation configured
- [ ] Backup script created and scheduled
- [ ] Monitoring tools installed (PM2 monit, htop)
- [ ] Security updates enabled
- [ ] SSH hardened (no root login, key-based auth)
- [ ] Application tested and accessible via domain

---

## Support

For issues specific to this application, refer to:
- Application logs: `/opt/network-topology/logs/`
- Database schema: `shared/schema.ts`
- API documentation: Check `server/routes.ts`

**Your Network Topology Manager is now production-ready! 🎉**
