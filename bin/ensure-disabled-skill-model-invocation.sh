#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${SKILLS_TARGET_DIR:-$(git rev-parse --show-toplevel)/.agents/skills}"
DISABLED_SKILLS=(
  "chrome-cdp"
  "gh-stack"
  "hegel"
  "thermo-nuclear-code-quality-review"
  "weekly-review"
  "what-did-i-get-done"
)

temp_file=""
trap 'rm -f "$temp_file"' EXIT

for skill in "${DISABLED_SKILLS[@]}"; do
  skill_file="$TARGET_DIR/$skill/SKILL.md"
  if [[ ! -f "$skill_file" ]]; then
    echo "Missing skill file: $skill_file" >&2
    exit 1
  fi

  temp_file=$(mktemp)
  awk -v skill_file="$skill_file" '
    BEGIN { in_frontmatter = 1 }
    NR == 1 {
      if ($0 != "---") {
        print "Missing YAML frontmatter in " skill_file > "/dev/stderr"
        invalid = 1
        exit 1
      }
      print
      next
    }
    in_frontmatter && /^---[[:space:]]*$/ {
      if (!found) print "disable-model-invocation: true"
      print
      in_frontmatter = 0
      next
    }
    in_frontmatter && /^[[:space:]]*disable-model-invocation[[:space:]]*:/ {
      if (!found) print "disable-model-invocation: true"
      found = 1
      next
    }
    { print }
    END {
      if (!invalid && in_frontmatter) {
        print "Unclosed YAML frontmatter in " skill_file > "/dev/stderr"
        exit 1
      }
    }
  ' "$skill_file" > "$temp_file"
  cat "$temp_file" > "$skill_file"
  rm -f "$temp_file"
  temp_file=""
done
