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
cp ".psql/queries/"* "$HOME/.psql/queries"

mkdir -p "$HOME/.local"
cp -r ".local/"* "$HOME/.local"

mkdir -p "$HOME/.ssh"
cp -r ".ssh/"* "$HOME/.ssh"

mkdir -p "$HOME/.claude"
cp -r ".claude/"* "$HOME/.claude"

mkdir -p "$HOME/.agents"
cp -r ".agents/"* "$HOME/.agents"

mkdir -p "$HOME/.config"
cp -r ".config/"* "$HOME/.config"

mkdir -p "$HOME/.raycast-scripts"
cp -r ".raycast-scripts/"* "$HOME/.raycast-scripts"

mkdir -p "$HOME/Library/Application Support/go/telemetry"
cp "Library/Application Support/go/telemetry/"* "$HOME/Library/Application Support/go/telemetry"
