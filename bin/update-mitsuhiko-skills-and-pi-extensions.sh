#!/usr/bin/env bash
set -e

REPO_URL="https://github.com/mitsuhiko/agent-stuff.git"
SKILLS_PATH="skills"
TARGET_DIR="$(git rev-parse --show-toplevel)/.agents/skills"
EXTENSIONS_PATH="extensions"
EXTENSIONS_TARGET_DIR="$(git rev-parse --show-toplevel)/.pi/agent/extensions"

# Clone to temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "Fetching latest mitsuhiku skills/extensions..."
git clone --depth 1 --filter=blob:none --sparse "$REPO_URL" "$TEMP_DIR"
cd "$TEMP_DIR"
git sparse-checkout set "$SKILLS_PATH"

# Sync each skill folder individually
mkdir -p "$TARGET_DIR"
for skill_dir in "$TEMP_DIR/$SKILLS_PATH"/*/; do
  skill_name=$(basename "$skill_dir")
  echo "Syncing $skill_name..."
  cp -r "$skill_dir" "$TARGET_DIR/$skill_name/"
done

SYNC_EXTENSIONS=(
  "answer.ts"
  "btw.ts"
  "context.ts"
  "control.ts"
  "loop.ts"
  "multi-edit.ts"
  "review.ts"
  "session-breakdown.ts"
  "split-fork.ts"
  "todos.ts"
  "whimsical.ts"
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
  cp "$extension" "$EXTENSIONS_TARGET_DIR/${extension_name}"
done
