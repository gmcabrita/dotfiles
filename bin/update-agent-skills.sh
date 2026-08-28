#!/usr/bin/env bash
set -euo pipefail

export DISABLE_TELEMETRY=1

cd "$(git rev-parse --show-toplevel)"

install_skills() {
  skills add "$@" --agent universal --yes
}

install_skills pasky/chrome-cdp-skill \
  --skill chrome-cdp
install_skills cursor/plugins \
  --skill fix-merge-conflicts \
  --skill thermo-nuclear-code-quality-review \
  --skill weekly-review \
  --skill what-did-i-get-done
install_skills github/gh-stack \
  --skill gh-stack
install_skills humanlayer/skills \
  --skill show-me
install_skills mitsuhiko/agent-stuff \
  --skill librarian \
  --skill uv
