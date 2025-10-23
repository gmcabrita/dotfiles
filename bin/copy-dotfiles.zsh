#!/usr/bin/env zsh

cp .gitconfig $HOME/
cp .gitignore $HOME/
cp .githelpers $HOME/
cp .zshrc $HOME/
cp .default-gems $HOME/
cp .psqlrc $HOME/
cp .editrc $HOME/
cp .sqliterc $HOME/
cp .iex.exs $HOME/

mkdir -p $HOME/Developer

mkdir -p $HOME/.psql/queries
cp .psql/queries/* $HOME/.psql/queries

mkdir -p $HOME/.bin
cp .bin/* $HOME/.bin

mkdir -p $HOME/.config/ghostty
cp .config/ghostty/* $HOME/.config/ghostty

mkdir -p $HOME/.config/zed
cp .config/zed/* $HOME/.config/zed

mkdir -p $HOME/.config/jj
cp .config/jj/* $HOME/.config/jj

mkdir -p $HOME/.config
cp -r .config/* $HOME/.config

mkdir -p $HOME/Library/Application\ Support/go/telemetry
cp Library/Application\ Support/go/telemetry/* $HOME/Library/Application\ Support/go/telemetry

mkdir -p $HOME/Library/Application\ Support/Sublime\ Text
cp -rf Library/Application\ Support/Sublime\ Text $HOME/Library/Application\ Support

mkdir -p $HOME/Library/Application\ Support/mods
cp Library/Application\ Support/mods/* $HOME/Library/Application\ Support/mods

if (( ${#HOME/Library/Application\ Support/Firefox/Profiles/*(N/)} > 0 )); then
  for dir in $HOME/Library/Application\ Support/Firefox/Profiles/*(N/); do
      cp -r .firefox-profiles/* "$dir"
  done
fi
