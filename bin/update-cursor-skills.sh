#!/usr/bin/env bash
set -e

REPO_URL="https://github.com/cursor/plugins.git"
SKILLS_PATH="cursor-team-kit/skills"
TARGET_DIR="$(git rev-parse --show-toplevel)/.agents/skills"

# Clone to temp directory
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

echo "Fetching latest cursor skills..."
git clone --depth 1 --filter=blob:none --sparse "$REPO_URL" "$TEMP_DIR"
cd "$TEMP_DIR"
git sparse-checkout set "$SKILLS_PATH"

SYNC_SKILLS=(
  "fix-merge-conflicts"
  "thermo-nuclear-code-quality-review"
  "weekly-review"
  "what-did-i-get-done"
)

# Sync each skill folder individually
mkdir -p "$TARGET_DIR"
for skill_dir in "$TEMP_DIR/$SKILLS_PATH"/*/; do
    skill_name=$(basename "$skill_dir")
    if [[ ! " ${SYNC_SKILLS[*]} " =~ ${skill_name} ]]; then
      continue
    fi

    echo "Syncing $skill_name..."
    cp -r "$skill_dir" "$TARGET_DIR/$skill_name/"
done
