#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/mitsuhiko/agent-stuff.git"
EXTENSIONS_PATH="extensions"
EXTENSIONS_TARGET_DIR="$(git rev-parse --show-toplevel)/.pi/agent/extensions"

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

echo "Fetching latest mitsuhiko Pi extensions..."
git clone --depth 1 --filter=blob:none --sparse "$REPO_URL" "$TEMP_DIR"
cd "$TEMP_DIR"
git sparse-checkout set "$EXTENSIONS_PATH"

SYNC_EXTENSIONS=(
  "subagent.ts"
  "todos.ts"
)

mkdir -p "$EXTENSIONS_TARGET_DIR"
for extension in "$TEMP_DIR/$EXTENSIONS_PATH"/*; do
  extension_name=$(basename "$extension")
  for selected_extension in "${SYNC_EXTENSIONS[@]}"; do
    if [[ "$extension_name" == "$selected_extension" ]]; then
      echo "Syncing $extension_name..."
      cp "$extension" "$EXTENSIONS_TARGET_DIR/${extension_name}"
      break
    fi
  done
done
