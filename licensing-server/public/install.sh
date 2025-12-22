#!/bin/bash
set -e

# CoreBit Network Manager - Quick Install Script
# Usage: curl -fsSL https://licensing.corebit.ease.dk/install.sh | sudo bash
# Options: --update (update existing installation)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

LICENSING_URL="${LICENSING_URL:-https://licensing.corebit.ease.dk}"
DOWNLOAD_URL="${DOWNLOAD_URL:-${LICENSING_URL}/releases/latest.zip}"

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}       ${GREEN}CoreBit Network Manager - Quick Install${NC}            ${BLUE}║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check root
if [[ $EUID -ne 0 ]]; then
    echo -e "${RED}Error: Please run as root${NC}"
    echo -e "Usage: curl -fsSL ${LICENSING_URL}/install.sh | sudo bash"
    exit 1
fi

# Check for required tools
for cmd in wget unzip; do
    if ! command -v $cmd &> /dev/null; then
        echo -e "${YELLOW}Installing $cmd...${NC}"
        apt-get update -qq && apt-get install -y -qq $cmd
    fi
done

# Download and extract
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

echo -e "${BLUE}Downloading latest release from licensing server...${NC}"
if ! wget -q --show-progress "$DOWNLOAD_URL" -O release.zip; then
    echo -e "${RED}Failed to download release. Check if releases are available.${NC}"
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo -e "${BLUE}Extracting...${NC}"
unzip -q release.zip

# Find the extracted directory
EXTRACTED_DIR=$(find . -maxdepth 1 -type d -name "corebit*" | head -1)
if [ -z "$EXTRACTED_DIR" ]; then
    echo -e "${RED}Error: Could not find extracted CoreBit directory${NC}"
    rm -rf "$TEMP_DIR"
    exit 1
fi

cd "$EXTRACTED_DIR"

echo -e "${BLUE}Running installer...${NC}"
echo ""

# Pass --url to use already-extracted files (skip re-download)
# Pass all other arguments from user
bash deploy/kickstart.sh --url "$(pwd)" "$@"

# Cleanup
cd /
rm -rf "$TEMP_DIR"

echo ""
echo -e "${GREEN}Installation complete!${NC}"
