#!/usr/bin/env zsh

cp .gitconfig $HOME/
cp .zshrc $HOME/
cp .default-gems $HOME/
cp .psqlrc $HOME/

mkdir -p $HOME/.psql/queries
cp .psql/queries/* $HOME/.psql/queries

mkdir -p $HOME/.bin
cp .bin/* $HOME/.bin

mkdir -p $HOME/.config/ghostty
cp .config/ghostty/* $HOME/.config/ghostty

mkdir -p $HOME/.config/zed
cp .config/zed/* $HOME/.config/zed

mkdir -p $HOME/Library/Application\ Support/mods
cp Library/Application\ Support/mods/* $HOME/Library/Application\ Support/mods

# iCloud Drive symlink
ln -s "$HOME/Library/Mobile Documents/com~apple~CloudDocs" "$HOME/iCloud Drive"

# Brew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Rosetta
/usr/sbin/softwareupdate --install-rosetta --agree-to-license

# Set hostname
vared -p "Computer name: " -c name
sudo scutil --set ComputerName $name
sudo scutil --set HostName $name
sudo scutil --set LocalHostName $name
sudo defaults write /Library/Preferences/SystemConfiguration/com.apple.smb.server NetBIOSName -string $name

# Enable full keyboard access for all controls (Accessibility pane)
defaults write NSGlobalDomain AppleKeyboardUIMode -int 3

# Press-and-hold should repeat the key, not pop a dialog for special keys.
defaults write NSGlobalDomain ApplePressAndHoldEnabled -bool false

# Disable minimizing windows with cmd+m
defaults write -g NSUserKeyEquivalents -dict-add 'Minimize' '\0'

# Enable moving window with ctrl+cmd+click
defaults write -g NSWindowShouldDragOnGesture -bool true

# Fast keyboard repeat rate
defaults write NSGlobalDomain KeyRepeat -int 1
defaults write NSGlobalDomain InitialKeyRepeat -int 10

# Enable F1, etc by default
defaults write -g com.apple.keyboard.fnState -bool true

# Disable autocapitalize
defaults write NSGlobalDomain NSAutomaticCapitalizationEnabled -bool false

# Disable autocorrect
defaults write NSGlobalDomain NSAutomaticSpellingCorrectionEnabled -bool false

# Disable period substitution
defaults write NSGlobalDomain NSAutomaticPeriodSubstitutionEnabled -bool false

# Disable smart quotes and dashes
defaults write NSGlobalDomain NSAutomaticDashSubstitutionEnabled -bool false

# Disable text replacements
defaults write NSGlobalDomain NSUserDictionaryReplacementItems -array

# Same, but for Apple Notes
defaults write com.apple.Notes ShouldCorrectSpellingAutomatically -bool false
defaults write com.apple.Notes ShouldUseSmartDashes -bool false
defaults write com.apple.Notes ShouldUseSmartQuotes -bool false

# TODO: this does not work
# Don't adjust screen brightness in low light
# sudo defaults write /Library/Preferences/com.apple.iokit.AmbientLightSensor "Automatic Display Enabled" -bool false

# Require password immediately after display sleep or screen saver begins
defaults write com.apple.screensaver askForPassword -int 1
defaults write com.apple.screensaver askForPasswordDelay -int 0

# New Finder window opens home directory by default.
defaults write com.apple.finder NewWindowTarget -string "PfLo"
defaults write com.apple.finder NewWindowTargetPath -string "file://{$HOME}/"

# Show more things in a Finder window
defaults write com.apple.Finder AppleShowAllFiles -bool true # show hidden files
defaults write NSGlobalDomain AppleShowAllExtensions -bool true # always show extensions
defaults write com.apple.finder ShowStatusBar -bool true # show status bar
defaults write com.apple.finder ShowPathbar -bool true # show path bar

# Don't warn when changing a file extension
defaults write com.apple.finder FXEnableExtensionChangeWarning -bool false

# Use column view by default
defaults write com.apple.finder FXPreferredViewStyle -string "clmv"

# Keep folders on top when sorting by name
defaults write com.apple.finder _FXSortFoldersFirst -bool true

# Expanded Save and Print dialogs by default
defaults write NSGlobalDomain NSNavPanelExpandedStateForSaveMode -bool true
defaults write NSGlobalDomain PMPrintingExpandedStateForPrint -bool true
defaults write NSGlobalDomain PMPrintingExpandedStateForPrint2 -bool true

# Save to disk, rather than iCloud, by default
defaults write NSGlobalDomain NSDocumentSaveNewDocumentsToCloud -bool false

# Wipe all default app icons from the dock
defaults write com.apple.dock persistent-apps -array

# Set Dock icon size to 36 pixels
defaults write com.apple.dock tilesize -int 36

# Dock on the right
defaults write com.apple.dock orientation -string "right"

# Set Dock minimize effect to scale
defaults write com.apple.dock mineffect -string "scale"

# Auto-hide the Dock
defaults write com.apple.dock autohide -bool true

# In Safari, don't send search queries to Apple
sudo defaults write com.apple.Safari UniversalSearchEnabled -bool false
sudo defaults write com.apple.Safari SuppressSearchSuggestions -bool true

# In Safari, show full URLs always
sudo defaults write com.apple.Safari ShowFullURLInSmartSearchField -bool true

# Increase file limits
sudo sysctl kern.maxfiles=64000 kern.maxfilesperproc=28000

brew install --cask 1password orbstack betterdisplay google-chrome linearmouse zed httpiee monodraw karabiner-elements db-browser-for-sqlite google-cloud-sdk spotify slack whatsapp telegram signal zoom raycast shureplus-motiv plex-media-server setapp macrorecorder notion-calendar
brew install --formula git gh sqlite fzf dos2unix colordiff bash asdf git-extras git-delta gnu-time jq fq less moreutils ncdu ripgrep grep rlwrap scc asciinema tree libpq cloud-sql-proxy glow gum mods vhs google-cloud-sdk gnu-tar gpg htop tailspin 1password-cli yt-dlp pgcli litecli hyperfine k9s rbspy vegeta ugrep btop neofetch tailscale
brew tap homebrew/cask-fonts
brew install --cask font-jetbrains-mono

$(brew --prefix)/opt/fzf/install

# Setup brew autoupdate (every 12 hours)
brew autoupdate start 43200

# asdf stuff

asdf plugin-add nodejs
asdf plugin-add bun
asdf plugin-add ruby
asdf plugin-add python
asdf plugin-add yarn
asdf plugin-add pnpm
asdf plugin-add zig
asdf plugin-add golang
asdf install nodejs $(asdf nodejs resolve lts --latest-available)
asdf install bun latest
asdf install ruby latest
asdf install python latest
asdf install yarn 1.22.19
asdf install pnpm latest
asdf install zig latest
asdf install golang latest
asdf global nodejs $(asdf nodejs resolve lts --latest-available)
asdf global bun latest
asdf global ruby latest
asdf global yarn 1.22.19
asdf global pnpm latest
asdf global zig latest
asdf global golang latest
