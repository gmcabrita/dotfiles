#!/usr/bin/env zsh

cp .gitconfig $HOME/
cp .gitignore $HOME/
cp .githelpers $HOME/
cp .zshrc $HOME/
cp .default-gems $HOME/
cp .psqlrc $HOME/
cp .sqliterc $HOME/
cp .iex.exs $HOME/

mkdir -p $HOME/Developer

mkdir -p $HOME/.psql/queries
cp .psql/queries/* $HOME/.psql/queries

mkdir -p $HOME/.bin
cp .bin/* $HOME/.bin

mkdir -p $HOME/.raycast-scripts
cp .raycast-scripts/* $HOME/.raycast-scripts

mkdir -p $HOME/.config/ghostty
cp .config/ghostty/* $HOME/.config/ghostty

mkdir -p $HOME/.config/zed
cp .config/zed/* $HOME/.config/zed

mkdir -p $HOME/Library/Application\ Support/go/telemetry
cp Library/Application\ Support/go/telemetry/* $HOME/Library/Application\ Support/go/telemetry

mkdir -p $HOME/Library/Application\ Support/Sublime\ Text
cp -rf Library/Application\ Support/Sublime\ Text $HOME/Library/Application\ Support
ANTHROPIC_API_KEY="op://Personal/ebpfp27lruzgaf57gwcxs7s4ka/password" op run --no-masking -- bash -c 'API_KEY=$(echo $ANTHROPIC_API_KEY); perl -pi -e "s/REDACTED/$API_KEY/g" $HOME/Library/Application\ Support/Sublime\ Text/Packages/User/Claudette.sublime-settings'

mkdir -p $HOME/Library/Application\ Support/mods
cp Library/Application\ Support/mods/* $HOME/Library/Application\ Support/mods

mkdir -p $HOME/Library/Application\ Support/jj
cp Library/Application\ Support/jj/* $HOME/Library/Application\ Support/jj
