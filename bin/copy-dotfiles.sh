#!/usr/bin/env bash

# TODO: consider migrating to https://mise.jdx.dev/dotfiles.html at some point

cp .hushlogin "$HOME/"
cp .gitconfig "$HOME/"
cp .gitignore "$HOME/"
cp .worktreeinclude "$HOME/"
cp .githelpers "$HOME/"
cp .zshrc "$HOME/"
cp .default-gems "$HOME/"
cp .psqlrc "$HOME/"
cp .editrc "$HOME/"
cp .sqliterc "$HOME/"
cp .iex.exs "$HOME/"
cp .npmrc "$HOME/"
cp .bunfig.toml "$HOME/"

mkdir -p "$HOME/Developer"

mkdir -p "$HOME/.psql/queries"
rsync -a ".psql/queries/" "$HOME/.psql/queries/"

mkdir -p "$HOME/.local"
rsync -a ".local/" "$HOME/.local/"

mkdir -p "$HOME/.ssh"
rsync -a ".ssh/" "$HOME/.ssh/"

mkdir -p "$HOME/.agents/skills"
rsync -a --delete ".agents/skills/" "$HOME/.agents/skills/"

mkdir -p "$HOME/.codiff"
rsync -a ".codiff/" "$HOME/.codiff/"

mkdir -p "$HOME/.config"
rsync -a ".config/" "$HOME/.config/"

mkdir -p "$HOME/.pi"
if [ ! -f "$HOME/.pi/agent/auth.json" ]; then
  rsync -a ".pi/" "$HOME/.pi/"
else
  rsync -a --exclude "agent/auth.json" ".pi/" "$HOME/.pi/"
fi
mkdir -p "$HOME/.pi/agent/extensions" "$HOME/.pi/agent/prompts" "$HOME/.pi/agent/skills"
rsync -a --delete ".pi/agent/extensions/" "$HOME/.pi/agent/extensions/"
rsync -a --delete ".pi/agent/prompts/" "$HOME/.pi/agent/prompts/"
# rsync -a --delete ".pi/agent/skills/" "$HOME/.pi/agent/skills/"
cp .AGENTS.md "$HOME/.pi/agent/AGENTS.md"

mkdir -p "$HOME/.raycast-scripts"
rsync -a ".raycast-scripts/" "$HOME/.raycast-scripts/"

mkdir -p "$HOME/Library/Application Support/go/telemetry"
rsync -a "Library/Application Support/go/telemetry/" "$HOME/Library/Application Support/go/telemetry/"

mkdir -p "$HOME/Library/Preferences/pnpm"
rsync -a "Library/Preferences/pnpm/" "$HOME/Library/Preferences/pnpm/"
