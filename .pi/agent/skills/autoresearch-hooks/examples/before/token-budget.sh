#!/usr/bin/env bash
# Nudge the agent when cumulative iteration tokens approach a budget.
# Reads iterationTokens from every run entry in autoresearch.jsonl.

set -euo pipefail

readonly BUDGET=1000000
readonly WARN_AT=800000

total_iteration_tokens() {
  jq -s '[.[] | select(.run != null) | .iterationTokens // 0] | add // 0' "$1" 2>/dev/null
}

exceeds_warn_threshold() {
  [ "$1" -ge "$WARN_AT" ]
}

input="$(cat)"
jsonl="$(jq -r '.cwd' <<<"$input")/autoresearch.jsonl"
total=$(total_iteration_tokens "$jsonl")

exceeds_warn_threshold "$total" || exit 0

remaining=$((BUDGET - total))
echo "⚠️ Token usage: $total / $BUDGET ($remaining remaining). Wrap up high-value ideas."
