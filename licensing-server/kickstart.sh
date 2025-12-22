#!/bin/bash
set -e

#===============================================================================
# CoreBit Licensing Server - Kickstart Installer
# 
# One-line install:
#   curl -fsSL https://licensing.corebit.ease.dk/install.sh | sudo bash
#
# Options:
#   --update              Update existing installation
#   --uninstall           Remove the application
#   --port PORT           Server port (default: 3001)
#   --domain DOMAIN       Domain name for the server (for BASE_URL)
#   --stripe-key KEY      Stripe secret key
#   --stripe-webhook KEY  Stripe webhook secret
#   --stripe-price ID     Stripe price ID
#   --verbose             Show detailed output
#===============================================================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Default configuration
INSTALL_DIR="/opt/corebit-licensing"
SERVICE_NAME="corebit-licensing"
APP_PORT=3001
DOMAIN=""
STRIPE_SECRET_KEY=""
STRIPE_WEBHOOK_SECRET=""
STRIPE_PRICE_ID=""

# Parse command line arguments
UPDATE_MODE=false
UNINSTALL_MODE=false
VERBOSE_MODE=false

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
        --port)
            APP_PORT="$2"
            shift 2
            ;;
        --domain)
            DOMAIN="$2"
            shift 2
            ;;
        --stripe-key)
            STRIPE_SECRET_KEY="$2"
            shift 2
            ;;
        --stripe-webhook)
            STRIPE_WEBHOOK_SECRET="$2"
            shift 2
            ;;
        --stripe-price)
            STRIPE_PRICE_ID="$2"
            shift 2
            ;;
        --verbose|-v)
            VERBOSE_MODE=true
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

install_nodejs() {
    log_info "Installing Node.js..."
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -ge 18 ]; then
            log_info "Node.js $(node -v) already installed"
            return
        fi
    fi
    
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    log_success "Node.js $(node -v) installed"
}

generate_admin_secret() {
    openssl rand -hex 32
}

install_application() {
    log_info "Installing CoreBit Licensing Server..."
    
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR/keys"
    
    # Copy files (assuming they're in current directory or downloaded)
    if [ -f "server.js" ]; then
        cp server.js "$INSTALL_DIR/"
        cp package.json "$INSTALL_DIR/"
        cp generate-keys.js "$INSTALL_DIR/"
        cp .env.example "$INSTALL_DIR/" 2>/dev/null || true
        # Copy admin UI
        if [ -d "public" ]; then
            cp -r public "$INSTALL_DIR/"
        fi
    else
        log_error "Source files not found. Please run from the licensing-server directory."
        exit 1
    fi
    
    cd "$INSTALL_DIR"
    npm install
    
    log_success "Application installed to $INSTALL_DIR"
}

generate_keys() {
    log_info "Generating RSA signing keys..."
    cd "$INSTALL_DIR"
    
    if [ -f "keys/private.pem" ]; then
        log_info "Keys already exist, skipping generation"
    else
        node generate-keys.js
        log_success "RSA keys generated"
    fi
}

configure_environment() {
    log_info "Configuring environment..."
    
    ENV_FILE="$INSTALL_DIR/.env"
    
    # Generate admin secret if not exists
    if [ -f "$ENV_FILE" ]; then
        EXISTING_SECRET=$(grep "^ADMIN_SECRET=" "$ENV_FILE" | cut -d'=' -f2)
    fi
    
    ADMIN_SECRET="${EXISTING_SECRET:-$(generate_admin_secret)}"
    
    # Generate or preserve admin UI credentials
    if [ -f "$ENV_FILE" ]; then
        EXISTING_ADMIN_USER=$(grep "^ADMIN_USERNAME=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2)
        EXISTING_ADMIN_PASS=$(grep "^ADMIN_PASSWORD=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2)
    fi
    ADMIN_USERNAME="${EXISTING_ADMIN_USER:-admin}"
    ADMIN_PASSWORD="${EXISTING_ADMIN_PASS:-$(openssl rand -base64 16)}"
    
    # Determine BASE_URL
    if [ -n "$DOMAIN" ]; then
        BASE_URL="https://$DOMAIN"
    else
        BASE_URL="http://localhost:$APP_PORT"
    fi
    
    cat > "$ENV_FILE" << EOF
PORT=$APP_PORT
ADMIN_SECRET=$ADMIN_SECRET
BASE_URL=$BASE_URL

# Admin UI Credentials
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_PASSWORD=$ADMIN_PASSWORD

# Stripe Configuration (required for payment processing)
STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET=$STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_ID=$STRIPE_PRICE_ID
EOF

    chmod 600 "$ENV_FILE"
    log_success "Environment configured"
    
    if [ -z "$STRIPE_SECRET_KEY" ]; then
        log_warning "Stripe not configured. Edit $ENV_FILE to add Stripe credentials."
    fi
}

setup_systemd() {
    log_info "Setting up systemd service..."
    
    cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=CoreBit Licensing Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    log_success "Systemd service configured"
}

start_service() {
    log_info "Starting service..."
    systemctl restart "$SERVICE_NAME"
    sleep 2
    
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log_success "Service started successfully"
    else
        log_error "Service failed to start. Check: journalctl -u $SERVICE_NAME -f"
        exit 1
    fi
}

uninstall() {
    log_info "Uninstalling CoreBit Licensing Server..."
    
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
    
    if [ -d "$INSTALL_DIR" ]; then
        BACKUP_DIR="/tmp/corebit-licensing-backup-$(date +%Y%m%d%H%M%S)"
        mkdir -p "$BACKUP_DIR"
        cp -r "$INSTALL_DIR/.env" "$BACKUP_DIR/" 2>/dev/null || true
        cp -r "$INSTALL_DIR/keys" "$BACKUP_DIR/" 2>/dev/null || true
        cp -r "$INSTALL_DIR/licenses.db" "$BACKUP_DIR/" 2>/dev/null || true
        log_info "Data backed up to: $BACKUP_DIR"
    fi
    
    rm -rf "$INSTALL_DIR"
    log_success "Uninstallation complete"
}

show_completion() {
    LOCAL_IP=$(hostname -I | awk '{print $1}')
    ADMIN_SECRET=$(grep "^ADMIN_SECRET=" "$INSTALL_DIR/.env" | cut -d'=' -f2)
    ADMIN_USER=$(grep "^ADMIN_USERNAME=" "$INSTALL_DIR/.env" | cut -d'=' -f2)
    ADMIN_PASS=$(grep "^ADMIN_PASSWORD=" "$INSTALL_DIR/.env" | cut -d'=' -f2)
    
    echo ""
    echo -e "${GREEN}======================================================${NC}"
    echo -e "${GREEN}  CoreBit Licensing Server - Installation Complete!${NC}"
    echo -e "${GREEN}======================================================${NC}"
    echo ""
    echo -e "  ${BLUE}Server URL:${NC}      http://${LOCAL_IP}:${APP_PORT}"
    echo -e "  ${BLUE}Admin Panel:${NC}     http://${LOCAL_IP}:${APP_PORT}/"
    echo -e "  ${BLUE}Health Check:${NC}    http://${LOCAL_IP}:${APP_PORT}/health"
    echo ""
    echo -e "  ${BLUE}Admin Panel Login:${NC}"
    echo -e "    Username:      $ADMIN_USER"
    echo -e "    Password:      $ADMIN_PASS"
    echo -e "  ${YELLOW}(Save these credentials to access the admin panel)${NC}"
    echo ""
    echo -e "  ${BLUE}API Admin Secret:${NC} $ADMIN_SECRET"
    echo -e "  ${YELLOW}(Used for programmatic API access)${NC}"
    echo ""
    echo -e "  ${BLUE}Service Commands:${NC}"
    echo "    Start:    sudo systemctl start $SERVICE_NAME"
    echo "    Stop:     sudo systemctl stop $SERVICE_NAME"
    echo "    Restart:  sudo systemctl restart $SERVICE_NAME"
    echo "    Logs:     sudo journalctl -u $SERVICE_NAME -f"
    echo ""
    echo -e "  ${BLUE}Configuration:${NC}   $INSTALL_DIR/.env"
    echo ""
    
    STRIPE_KEY=$(grep "^STRIPE_SECRET_KEY=" "$INSTALL_DIR/.env" | cut -d'=' -f2)
    if [ -z "$STRIPE_KEY" ]; then
        echo -e "  ${YELLOW}Next Steps:${NC}"
        echo "    1. Edit $INSTALL_DIR/.env"
        echo "    2. Add your Stripe credentials:"
        echo "       - STRIPE_SECRET_KEY (from Stripe Dashboard → Developers → API keys)"
        echo "       - STRIPE_WEBHOOK_SECRET (from Stripe Dashboard → Developers → Webhooks)"
        echo "       - STRIPE_PRICE_ID (from your Product's pricing section)"
        echo "    3. Restart: sudo systemctl restart $SERVICE_NAME"
        echo ""
    fi
    
    echo -e "${GREEN}======================================================${NC}"
}

main() {
    echo ""
    echo -e "${BLUE}======================================================${NC}"
    echo -e "${BLUE}  CoreBit Licensing Server - Installer${NC}"
    echo -e "${BLUE}======================================================${NC}"
    echo ""
    
    check_root
    
    if [ "$UNINSTALL_MODE" = true ]; then
        uninstall
        exit 0
    fi
    
    apt-get update -qq
    apt-get install -y -qq curl openssl
    
    install_nodejs
    install_application
    generate_keys
    configure_environment
    setup_systemd
    start_service
    
    show_completion
}

main "$@"
