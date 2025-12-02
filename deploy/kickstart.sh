#!/bin/bash
set -e

#===============================================================================
# CoreBit Network Manager - Kickstart Installer
# 
# One-line install:
#   curl -fsSL https://your-server.com/corebit/install.sh | sudo bash
#
# Or download and run:
#   wget https://your-server.com/corebit/kickstart.sh
#   chmod +x kickstart.sh
#   sudo ./kickstart.sh
#
# Options:
#   --update          Update existing installation
#   --uninstall       Remove the application
#   --no-db           Skip database setup (use external database)
#   --db-host HOST    PostgreSQL host (default: localhost)
#   --db-port PORT    PostgreSQL port (default: 5432)
#   --db-name NAME    Database name (default: corebit)
#   --db-user USER    Database user (default: corebit)
#   --port PORT       Application port (default: 3000)
#===============================================================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default configuration
INSTALL_DIR="/opt/corebit"
SERVICE_NAME="corebit"
SERVICE_USER="corebit"
APP_PORT=3000
DB_HOST="localhost"
DB_PORT=5432
DB_NAME="corebit"
DB_USER="corebit"
DOWNLOAD_URL="${DOWNLOAD_URL:-https://your-server.com/corebit/releases/latest.zip}"

# Parse command line arguments
UPDATE_MODE=false
UNINSTALL_MODE=false
SKIP_DB=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --update)
            UPDATE_MODE=true
            shift
            ;;
        --uninstall)
            UNINSTALL_MODE=true
            shift
            ;;
        --no-db)
            SKIP_DB=true
            shift
            ;;
        --db-host)
            DB_HOST="$2"
            shift 2
            ;;
        --db-port)
            DB_PORT="$2"
            shift 2
            ;;
        --db-name)
            DB_NAME="$2"
            shift 2
            ;;
        --db-user)
            DB_USER="$2"
            shift 2
            ;;
        --port)
            APP_PORT="$2"
            shift 2
            ;;
        --url)
            DOWNLOAD_URL="$2"
            shift 2
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        VERSION=$VERSION_ID
    elif [ -f /etc/debian_version ]; then
        OS="debian"
    elif [ -f /etc/redhat-release ]; then
        OS="rhel"
    else
        log_error "Unsupported operating system"
        exit 1
    fi
    log_info "Detected OS: $OS $VERSION"
}

install_dependencies() {
    log_info "Installing system dependencies..."
    
    case $OS in
        ubuntu|debian)
            apt-get update -qq
            apt-get install -y -qq curl wget unzip postgresql postgresql-contrib nodejs npm
            ;;
        centos|rhel|fedora|rocky|almalinux)
            if command -v dnf &> /dev/null; then
                dnf install -y curl wget unzip postgresql-server postgresql nodejs npm
            else
                yum install -y curl wget unzip postgresql-server postgresql nodejs npm
            fi
            ;;
        *)
            log_error "Unsupported OS for automatic dependency installation"
            log_info "Please install manually: curl, wget, unzip, postgresql, nodejs (v18+)"
            exit 1
            ;;
    esac
    
    # Check Node.js version
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        log_warning "Node.js version is too old. Installing Node.js 20..."
        install_nodejs
    fi
    
    log_success "Dependencies installed"
}

install_nodejs() {
    log_info "Installing Node.js 20 LTS..."
    
    case $OS in
        ubuntu|debian)
            curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
            apt-get install -y nodejs
            ;;
        centos|rhel|fedora|rocky|almalinux)
            curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
            if command -v dnf &> /dev/null; then
                dnf install -y nodejs
            else
                yum install -y nodejs
            fi
            ;;
    esac
}

setup_postgresql() {
    if [ "$SKIP_DB" = true ]; then
        log_info "Skipping database setup (--no-db specified)"
        return
    fi
    
    log_info "Setting up PostgreSQL..."
    
    # Start PostgreSQL if not running
    case $OS in
        ubuntu|debian)
            systemctl enable postgresql
            systemctl start postgresql
            ;;
        centos|rhel|fedora|rocky|almalinux)
            postgresql-setup --initdb 2>/dev/null || true
            systemctl enable postgresql
            systemctl start postgresql
            ;;
    esac
    
    # Check if we have existing credentials from backup
    if [ -f "/tmp/corebit.env.backup" ]; then
        # Extract existing password from backup
        EXISTING_PW=$(grep "^PGPASSWORD=" /tmp/corebit.env.backup 2>/dev/null | cut -d'=' -f2)
        if [ -n "$EXISTING_PW" ]; then
            DB_PASSWORD="$EXISTING_PW"
            log_info "Using existing database password from backup"
        fi
    fi
    
    # Generate new password only if we don't have one
    if [ -z "$DB_PASSWORD" ]; then
        DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
        log_info "Generated new database password"
    fi
    
    # Create database and user
    sudo -u postgres psql <<EOF
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}') THEN
        CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';
    ELSE
        ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
    END IF;
END
\$\$;

SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
EOF

    log_success "PostgreSQL configured"
}

create_user() {
    log_info "Creating service user..."
    
    if ! id "$SERVICE_USER" &>/dev/null; then
        useradd --system --home-dir "$INSTALL_DIR" --shell /bin/false "$SERVICE_USER"
        log_success "Created user: $SERVICE_USER"
    else
        log_info "User $SERVICE_USER already exists"
    fi
}

download_application() {
    log_info "Downloading application..."
    
    # Create temp directory
    TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"
    
    # Download the release
    if [[ "$DOWNLOAD_URL" == *.zip ]]; then
        wget -q "$DOWNLOAD_URL" -O release.zip
        unzip -q release.zip
        rm release.zip
    elif [[ "$DOWNLOAD_URL" == *.tar.gz ]]; then
        wget -q "$DOWNLOAD_URL" -O release.tar.gz
        tar -xzf release.tar.gz
        rm release.tar.gz
    else
        # Assume it's a directory path (local install)
        cp -r "$DOWNLOAD_URL"/* .
    fi
    
    # Find extracted directory (handle nested directories)
    if [ -d "corebit" ]; then
        cd corebit
    fi
    
    log_success "Application downloaded"
}

backup_existing() {
    if [ -d "$INSTALL_DIR" ]; then
        log_info "Backing up existing installation..."
        BACKUP_DIR="${INSTALL_DIR}.backup.$(date +%Y%m%d%H%M%S)"
        
        # Backup .env file
        if [ -f "$INSTALL_DIR/.env" ]; then
            cp "$INSTALL_DIR/.env" "/tmp/corebit.env.backup"
        fi
        
        # Backup data directory if exists
        if [ -d "$INSTALL_DIR/data" ]; then
            cp -r "$INSTALL_DIR/data" "/tmp/corebit-data.backup"
        fi
        
        log_success "Backup created at $BACKUP_DIR"
    fi
}

install_application() {
    log_info "Installing application to $INSTALL_DIR..."
    
    # Create install directory
    mkdir -p "$INSTALL_DIR"
    
    # Copy files
    cp -r . "$INSTALL_DIR/"
    
    # Restore .env if exists
    if [ -f "/tmp/corebit.env.backup" ]; then
        cp "/tmp/corebit.env.backup" "$INSTALL_DIR/.env"
        log_info "Restored existing .env configuration"
    fi
    
    # Restore data if exists
    if [ -d "/tmp/corebit-data.backup" ]; then
        cp -r "/tmp/corebit-data.backup" "$INSTALL_DIR/data"
        log_info "Restored existing data"
    fi
    
    cd "$INSTALL_DIR"
    
    # Install npm dependencies
    log_info "Installing Node.js dependencies..."
    npm install --production --silent
    
    # Set ownership
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    
    log_success "Application installed"
}

configure_environment() {
    log_info "Configuring environment..."
    
    ENV_FILE="$INSTALL_DIR/.env"
    
    # Only create .env if it doesn't exist
    if [ ! -f "$ENV_FILE" ]; then
        # Generate session secret
        SESSION_SECRET=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
        
        cat > "$ENV_FILE" <<EOF
# CoreBit Network Manager - Configuration
# Generated on $(date)

# Server Configuration
NODE_ENV=production
PORT=${APP_PORT}
HOST=0.0.0.0

# Database Configuration
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}
PGHOST=${DB_HOST}
PGPORT=${DB_PORT}
PGDATABASE=${DB_NAME}
PGUSER=${DB_USER}
PGPASSWORD=${DB_PASSWORD}

# Session Configuration
SESSION_SECRET=${SESSION_SECRET}

# Optional: SNMP Configuration
# SNMP_COMMUNITY=public
# SNMP_TIMEOUT=5000

# Optional: External access (set to your domain/IP)
# BASE_URL=https://your-domain.com
EOF
        
        chmod 600 "$ENV_FILE"
        chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
        log_success "Environment configured"
    else
        log_info "Existing .env preserved"
    fi
}

run_migrations() {
    log_info "Running database migrations..."
    
    cd "$INSTALL_DIR"
    
    # Run Drizzle migrations
    sudo -u "$SERVICE_USER" npm run db:push 2>/dev/null || {
        log_warning "Migration command not found, trying alternative..."
        sudo -u "$SERVICE_USER" npx drizzle-kit push 2>/dev/null || true
    }
    
    log_success "Database migrations complete"
}

setup_systemd() {
    log_info "Setting up systemd service..."
    
    cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=CoreBit Network Manager
Documentation=https://github.com/your-org/corebit
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/node ${INSTALL_DIR}/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${INSTALL_DIR}/data
PrivateTmp=true

# Resource limits
LimitNOFILE=65535
MemoryMax=1G

[Install]
WantedBy=multi-user.target
EOF

    # Reload systemd
    systemctl daemon-reload
    
    # Enable service
    systemctl enable "$SERVICE_NAME"
    
    log_success "Systemd service configured"
}

start_service() {
    log_info "Starting service..."
    
    systemctl restart "$SERVICE_NAME"
    
    # Wait for service to start
    sleep 3
    
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log_success "Service started successfully"
    else
        log_error "Service failed to start. Check logs with: journalctl -u $SERVICE_NAME -f"
        exit 1
    fi
}

uninstall() {
    log_info "Uninstalling CoreBit Network Manager..."
    
    # Stop and disable service
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
    
    # Backup data before removal
    if [ -d "$INSTALL_DIR" ]; then
        BACKUP_DIR="/tmp/corebit-uninstall-backup-$(date +%Y%m%d%H%M%S)"
        mkdir -p "$BACKUP_DIR"
        cp -r "$INSTALL_DIR/.env" "$BACKUP_DIR/" 2>/dev/null || true
        cp -r "$INSTALL_DIR/data" "$BACKUP_DIR/" 2>/dev/null || true
        log_info "Configuration backed up to: $BACKUP_DIR"
    fi
    
    # Remove installation directory
    rm -rf "$INSTALL_DIR"
    
    # Remove user (optional, keeping for safety)
    # userdel "$SERVICE_USER" 2>/dev/null || true
    
    log_success "Uninstallation complete"
    log_info "Note: Database and user were preserved. Remove manually if needed."
}

show_completion() {
    LOCAL_IP=$(hostname -I | awk '{print $1}')
    
    echo ""
    echo -e "${GREEN}======================================================${NC}"
    echo -e "${GREEN}  CoreBit Network Manager - Installation Complete!${NC}"
    echo -e "${GREEN}======================================================${NC}"
    echo ""
    echo -e "  ${BLUE}Access URL:${NC}      http://${LOCAL_IP}:${APP_PORT}"
    echo -e "  ${BLUE}Default Login:${NC}   admin / admin"
    echo ""
    echo -e "  ${BLUE}Service Commands:${NC}"
    echo "    Start:    sudo systemctl start $SERVICE_NAME"
    echo "    Stop:     sudo systemctl stop $SERVICE_NAME"
    echo "    Restart:  sudo systemctl restart $SERVICE_NAME"
    echo "    Status:   sudo systemctl status $SERVICE_NAME"
    echo "    Logs:     sudo journalctl -u $SERVICE_NAME -f"
    echo ""
    echo -e "  ${BLUE}Configuration:${NC}   $INSTALL_DIR/.env"
    echo -e "  ${BLUE}Installation:${NC}    $INSTALL_DIR"
    echo ""
    echo -e "  ${YELLOW}Important:${NC} Change the default admin password after first login!"
    echo ""
    echo -e "${GREEN}======================================================${NC}"
}

# Main installation flow
main() {
    echo ""
    echo -e "${BLUE}======================================================${NC}"
    echo -e "${BLUE}  CoreBit Network Manager - Installer${NC}"
    echo -e "${BLUE}======================================================${NC}"
    echo ""
    
    check_root
    detect_os
    
    if [ "$UNINSTALL_MODE" = true ]; then
        uninstall
        exit 0
    fi
    
    if [ "$UPDATE_MODE" = true ]; then
        log_info "Running in update mode..."
    fi
    
    install_dependencies
    setup_postgresql
    create_user
    backup_existing
    download_application
    install_application
    configure_environment
    run_migrations
    setup_systemd
    start_service
    
    # Cleanup
    rm -rf "$TEMP_DIR"
    rm -f /tmp/corebit.env.backup
    rm -rf /tmp/corebit-data.backup
    
    show_completion
}

main "$@"
