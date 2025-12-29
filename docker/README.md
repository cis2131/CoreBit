# CoreBit Docker Deployment

Run CoreBit Network Manager using Docker Compose with a self-contained PostgreSQL database.

## Quick Start

### 1. Download the Docker files

```bash
# Create a directory for CoreBit
mkdir corebit && cd corebit

# Download the Docker Compose files
curl -O https://raw.githubusercontent.com/clausdk/corebit/main/docker/docker-compose.yml
curl -O https://raw.githubusercontent.com/clausdk/corebit/main/docker/.env.example
```

### 2. Configure environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit the .env file and change at least the SESSION_SECRET
nano .env
```

**Important:** Change `SESSION_SECRET` to a random string for security.
Generate one with: `openssl rand -base64 32`

### 3. Start CoreBit

```bash
docker compose up -d
```

> **Note for contributors:** If you want to build from source, see [Building from Source](#building-from-source) below.

### 4. Access the application

Open your browser and go to: `http://localhost:3000`

**Default login:**
- Username: `admin`
- Password: `admin123`

## Updating

To update to the latest version:

```bash
# Pull the latest image
docker compose pull

# Restart with the new version
docker compose up -d
```

Your data is preserved in Docker volumes and will not be lost during updates.

## Data Persistence

All data is stored in Docker volumes that persist across container restarts and updates:

| Volume | Purpose |
|--------|---------|
| `corebit_db` | PostgreSQL database |
| `corebit_backups` | Application backups |
| `corebit_data` | Application data |

## Commands Reference

```bash
# Start in background
docker compose up -d

# View logs
docker compose logs -f

# View app logs only
docker compose logs -f app

# Stop all containers
docker compose down

# Stop and remove volumes (WARNING: deletes all data!)
docker compose down -v

# Restart the application
docker compose restart app

# Check container status
docker compose ps
```

## Configuration

### Environment Variables

Edit the `.env` file to configure:

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_PORT` | 3000 | Port to expose the application |
| `POSTGRES_USER` | corebit | Database username |
| `POSTGRES_PASSWORD` | corebit123 | Database password |
| `POSTGRES_DB` | corebit | Database name |
| `SESSION_SECRET` | (required) | Session encryption key |

### Using a Custom Port

To run on a different port (e.g., 8080):

```bash
# In .env
APP_PORT=8080

# Then restart
docker compose up -d
```

### Using an External Database

If you want to use an existing PostgreSQL database instead of the included one:

1. Create a `docker-compose.override.yml`:

```yaml
services:
  app:
    environment:
      DATABASE_URL: postgresql://user:pass@your-db-host:5432/corebit
    depends_on: []

  db:
    profiles:
      - disabled
```

2. Restart: `docker compose up -d`

## Troubleshooting

### Container won't start

Check the logs:
```bash
docker compose logs app
```

### Database connection issues

Ensure the database is healthy:
```bash
docker compose ps
docker compose logs db
```

### Permission issues with network operations

CoreBit needs `NET_RAW` and `NET_ADMIN` capabilities for ICMP ping and SNMP.
These are already configured in the compose file.

### Reset admin password

Add these to your `.env` file and restart:
```
ADMIN_RECOVERY_SECRET=your-secret-here
ADMIN_RECOVERY_PASSWORD=new-password
```

Then remove them after logging in.

## Building from Source

If you want to build the Docker image yourself:

```bash
# Clone the repository
git clone https://github.com/clausdk/corebit.git
cd corebit/docker

# Option 1: Use the build overlay file
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build

# Option 2: Manual build and run
docker build -f Dockerfile -t corebit:local ..
# Then edit docker-compose.yml and uncomment the build section
docker compose up -d
```

## Support

For issues and feature requests, visit:
https://github.com/clausdk/corebit/issues
