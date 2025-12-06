#!/bin/bash
# AFK-Bot Installation Script
# Deletes old files, downloads current files, installs Bun, installs dependencies, and starts the bot.

set -e

INSTALL_DIR="/mnt/server"
RAW_URL_BASE="http://raw.gravijet.net/olib/gravi/red/jet/cast/hugo/crafter"

echo "[INFO] Starting AFK-Bot installation in $INSTALL_DIR"

# Create installation directory if it doesn't exist
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Delete old files
echo "[INFO] Deleting old files..."
rm -rf ./*

# Install Bun if not installed
if ! command -v bun &> /dev/null; then
    echo "[INFO] Bun not found, installing..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

# Download project files
echo "[INFO] Downloading project files..."
for file in index.js package.json install.sh; do
    echo "[INFO] Downloading $file..."
    curl -fsSL "$RAW_URL_BASE/$file" -o "$file"
done

# Install dependencies
echo "[INFO] Installing dependencies with Bun..."
bun install --production

# Start the bot
echo "[INFO] Starting AFK-Bot..."
bun start
