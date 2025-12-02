#!/bin/bash
set -e

#===============================================================================
# CoreBit Network Manager - Release Builder
# 
# This script creates a distributable release package.
# Run from the project root: ./deploy/build-release.sh
#
# Output: Creates a zip file in dist/releases/
#===============================================================================

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get version from package.json or use date
VERSION=${1:-$(date +%Y%m%d%H%M%S)}
RELEASE_NAME="corebit-${VERSION}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_ROOT/dist/releases"
TEMP_DIR=$(mktemp -d)

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}  Building Release: ${RELEASE_NAME}${NC}"
echo -e "${BLUE}======================================================${NC}"
echo ""

cd "$PROJECT_ROOT"

# Step 1: Clean previous builds
echo -e "${BLUE}[1/7]${NC} Cleaning previous builds..."
rm -rf dist/releases/"${RELEASE_NAME}"*
mkdir -p "$BUILD_DIR"

# Step 2: Install dependencies
echo -e "${BLUE}[2/7]${NC} Installing dependencies..."
npm ci --silent

# Step 3: Build frontend
echo -e "${BLUE}[3/7]${NC} Building frontend..."
npm run build

# Step 4: Compile TypeScript backend
echo -e "${BLUE}[4/7]${NC} Compiling backend..."
npx esbuild server/index.ts --bundle --platform=node --outfile=dist/index.js --external:pg-native --external:better-sqlite3

# Step 5: Prepare release directory
echo -e "${BLUE}[5/7]${NC} Preparing release package..."
RELEASE_DIR="$TEMP_DIR/$RELEASE_NAME"
mkdir -p "$RELEASE_DIR"

# Copy built files
cp -r dist/public "$RELEASE_DIR/"
cp dist/index.js "$RELEASE_DIR/"

# Copy essential files
cp package.json "$RELEASE_DIR/"
cp package-lock.json "$RELEASE_DIR/" 2>/dev/null || true

# Copy deployment files
cp -r deploy "$RELEASE_DIR/"
chmod +x "$RELEASE_DIR/deploy/"*.sh 2>/dev/null || true

# Copy Drizzle files for migrations
mkdir -p "$RELEASE_DIR/drizzle"
cp drizzle.config.ts "$RELEASE_DIR/" 2>/dev/null || true
cp -r drizzle/* "$RELEASE_DIR/drizzle/" 2>/dev/null || true

# Copy shared schema for types
mkdir -p "$RELEASE_DIR/shared"
cp shared/schema.ts "$RELEASE_DIR/shared/" 2>/dev/null || true

# Create production package.json
cat > "$RELEASE_DIR/package.json" <<EOF
{
  "name": "corebit",
  "version": "${VERSION}",
  "description": "CoreBit - Modern network topology and monitoring",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "db:push": "drizzle-kit push"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "@neondatabase/serverless": "^0.10.0",
    "bcrypt": "^5.1.1",
    "connect-pg-simple": "^10.0.0",
    "dotenv": "^16.4.0",
    "drizzle-orm": "^0.36.0",
    "express": "^4.21.0",
    "express-session": "^1.18.0",
    "net-snmp": "^3.12.0",
    "node-routeros": "^1.6.0",
    "passport": "^0.7.0",
    "passport-local": "^1.0.0",
    "pg": "^8.13.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.0"
  }
}
EOF

# Create data directories
mkdir -p "$RELEASE_DIR/data/backups"

# Create a simple install wrapper
cat > "$RELEASE_DIR/install.sh" <<'EOF'
#!/bin/bash
# Quick install wrapper - runs the kickstart script
cd "$(dirname "$0")"
sudo bash deploy/kickstart.sh --url "$(pwd)" "$@"
EOF
chmod +x "$RELEASE_DIR/install.sh"

# Step 6: Create release archives
echo -e "${BLUE}[6/7]${NC} Creating release archives..."

cd "$TEMP_DIR"

# Create zip
zip -rq "$BUILD_DIR/${RELEASE_NAME}.zip" "$RELEASE_NAME"

# Create tar.gz
tar -czf "$BUILD_DIR/${RELEASE_NAME}.tar.gz" "$RELEASE_NAME"

# Create checksums
cd "$BUILD_DIR"
sha256sum "${RELEASE_NAME}.zip" > "${RELEASE_NAME}.zip.sha256"
sha256sum "${RELEASE_NAME}.tar.gz" > "${RELEASE_NAME}.tar.gz.sha256"

# Step 7: Cleanup
echo -e "${BLUE}[7/7]${NC} Cleaning up..."
rm -rf "$TEMP_DIR"

# Create latest symlinks
ln -sf "${RELEASE_NAME}.zip" "$BUILD_DIR/latest.zip"
ln -sf "${RELEASE_NAME}.tar.gz" "$BUILD_DIR/latest.tar.gz"

# Create install script for web download
cat > "$BUILD_DIR/install.sh" <<'INSTALL_SCRIPT'
#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

DOWNLOAD_URL="${DOWNLOAD_URL:-https://your-server.com/corebit/releases/latest.zip}"

echo -e "${BLUE}CoreBit Network Manager - Quick Install${NC}"
echo ""

# Check root
if [[ $EUID -ne 0 ]]; then
    echo -e "${RED}Please run as root: sudo bash install.sh${NC}"
    exit 1
fi

# Download and extract
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

echo "Downloading latest release..."
wget -q "$DOWNLOAD_URL" -O release.zip

echo "Extracting..."
unzip -q release.zip
cd corebit-*

echo "Running installer..."
bash deploy/kickstart.sh --url "$(pwd)" "$@"

# Cleanup
rm -rf "$TEMP_DIR"
INSTALL_SCRIPT
chmod +x "$BUILD_DIR/install.sh"

echo ""
echo -e "${GREEN}======================================================${NC}"
echo -e "${GREEN}  Release Built Successfully!${NC}"
echo -e "${GREEN}======================================================${NC}"
echo ""
echo -e "  ${BLUE}Release Files:${NC}"
echo "    $BUILD_DIR/${RELEASE_NAME}.zip"
echo "    $BUILD_DIR/${RELEASE_NAME}.tar.gz"
echo ""
echo -e "  ${BLUE}Checksums:${NC}"
echo "    $BUILD_DIR/${RELEASE_NAME}.zip.sha256"
echo "    $BUILD_DIR/${RELEASE_NAME}.tar.gz.sha256"
echo ""
echo -e "  ${BLUE}Quick Install Script:${NC}"
echo "    $BUILD_DIR/install.sh"
echo ""
echo -e "  ${YELLOW}To distribute:${NC}"
echo "    1. Upload files to your web server"
echo "    2. Update DOWNLOAD_URL in install.sh"
echo "    3. Users can install with:"
echo "       curl -fsSL https://your-server.com/corebit/install.sh | sudo bash"
echo ""
echo -e "${GREEN}======================================================${NC}"
