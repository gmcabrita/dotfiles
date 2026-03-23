#!/usr/bin/env bash

cp .hushlogin "$HOME/"
cp .gitconfig "$HOME/"
cp .gitignore "$HOME/"
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

mkdir -p "$HOME/.agents"
rsync -a ".agents/" "$HOME/.agents/"

mkdir -p "$HOME/.config"
rsync -a ".config/" "$HOME/.config/"
cp .AGENTS.md "$HOME/.config/opencode/AGENTS.md"

mkdir -p "$HOME/.pi"
if [ ! -f "$HOME/.pi/agent/auth.json" ]; then
  rsync -a ".pi/" "$HOME/.pi/"
else
  rsync -a --exclude "agent/auth.json" ".pi/" "$HOME/.pi/"
fi
cp .AGENTS.md "$HOME/.pi/agent/AGENTS.md"

mkdir -p "$HOME/.raycast-scripts"
rsync -a ".raycast-scripts/" "$HOME/.raycast-scripts/"

mkdir -p "$HOME/Library/Application Support/go/telemetry"
rsync -a "Library/Application Support/go/telemetry/" "$HOME/Library/Application Support/go/telemetry/"
