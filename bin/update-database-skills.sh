#!/usr/bin/env bash
set -e

REPO_URL="https://github.com/planetscale/database-skills.git"
SKILLS_PATH="skills"
TARGET_DIR="$(git rev-parse --show-toplevel)/.config/opencode/skill"

# Clone to temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "Fetching latest database skills..."
git clone --depth 1 --filter=blob:none --sparse "$REPO_URL" "$TEMP_DIR"
cd "$TEMP_DIR"
git sparse-checkout set "$SKILLS_PATH"

# Sync each skill folder individually
mkdir -p "$TARGET_DIR"
for skill_dir in "$TEMP_DIR/$SKILLS_PATH"/*/; do
    skill_name=$(basename "$skill_dir")
    echo "Syncing $skill_name..."
    rsync -av --delete "$skill_dir" "$TARGET_DIR/$skill_name/"
done
