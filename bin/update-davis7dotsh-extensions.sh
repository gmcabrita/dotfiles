#!/usr/bin/env bash
set -e

REPO_URL="https://github.com/davis7dotsh/my-pi-setup.git"
EXTENSIONS_PATH="extensions"
EXTENSIONS_TARGET_DIR="$(git rev-parse --show-toplevel)/.pi/agent/extensions"

# Clone to temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "Fetching latest davis7dotsh extensions..."
git clone --depth 1 --filter=blob:none --sparse "$REPO_URL" "$TEMP_DIR"
cd "$TEMP_DIR"

SYNC_EXTENSIONS=(
  "git-info"
  "model-info"
  "shared"
  "ui-customization"
)

git sparse-checkout set "$EXTENSIONS_PATH"
# Sync each extension file individually
mkdir -p "$EXTENSIONS_TARGET_DIR"
for extension in "$TEMP_DIR/$EXTENSIONS_PATH"/*; do
  extension_name=$(basename "$extension")
  if [[ ! " ${SYNC_EXTENSIONS[*]} " =~ ${extension_name} ]]; then
    continue
  fi

  echo "Syncing $extension_name..."
  cp -r "$extension" "$EXTENSIONS_TARGET_DIR/${extension_name}"
done
