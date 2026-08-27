#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/cloudflare/skills.git"
SKILLS_PATH="skills"
TARGET_DIR="$(git rev-parse --show-toplevel)/.agents/skills"
SYNC_SKILLS=(
  "cloudflare"
  "durable-objects"
  "workers-best-practices"
)

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

echo "Fetching latest Cloudflare skills..."
git clone --depth 1 --filter=blob:none --sparse "$REPO_URL" "$TEMP_DIR"
cd "$TEMP_DIR"
git sparse-checkout set "${SYNC_SKILLS[@]/#/$SKILLS_PATH/}"

for skill_name in "${SYNC_SKILLS[@]}"; do
  skill_dir="$TEMP_DIR/$SKILLS_PATH/$skill_name"
  if [[ ! -d "$skill_dir" ]]; then
    echo "Missing upstream skill: $skill_name" >&2
    exit 1
  fi
done

mkdir -p "$TARGET_DIR"
for skill_name in "${SYNC_SKILLS[@]}"; do
  skill_dir="$TEMP_DIR/$SKILLS_PATH/$skill_name"
  echo "Syncing $skill_name..."
  rm -rf "${TARGET_DIR:?}/$skill_name"
  cp -R "$skill_dir" "$TARGET_DIR/$skill_name"
done
