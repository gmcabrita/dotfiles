#!/usr/bin/env zsh

source bin/copy-dotfiles.zsh

mkdir ~/.zfunc

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

# Show advanced printing settings by default
defaults write NSGlobalDomain PMPrintingExpandedStateForPrint -bool true
defaults write NSGlobalDomain PMPrintingExpandedStateForPrint2 -bool true

# Disable the all finder animations
defaults write com.apple.finder DisableAllAnimations -bool true

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

# Set Zed as the default editor for plaintext files
defaults write com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers -array-add \
  '{LSHandlerContentType=public.plain-text;LSHandlerRoleAll=dev.zed.Zed;}' \
  '{LSHandlerContentType=public.unix-executable;LSHandlerRoleAll=dev.zed.Zed;}' \
  '{LSHandlerContentType=public.data;LSHandlerRoleAll=dev.zed.Zed;}'

# Same, but for Apple Notes
defaults write com.apple.Notes ShouldCorrectSpellingAutomatically -bool false
defaults write com.apple.Notes ShouldUseSmartDashes -bool false
defaults write com.apple.Notes ShouldUseSmartQuotes -bool false

# TODO: this does not work
# Don't adjust screen brightness in low light
# sudo defaults write /Library/Preferences/com.apple.iokit.AmbientLightSensor "Automatic Display Enabled" -bool false

# Make file proxy appear immediately (the little icon in the toolbar inside a window that you can drag to move the open file elsewhere)
defaults write NSGlobalDomain "NSToolbarTitleViewRolloverDelay" -float "0"

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
defaults write com.apple.dock autohide-delay -int 0
defaults write com.apple.dock autohide-time-modifier -float 0.4

# Speedup dock animations
defaults write com.apple.dock springboard-show-duration -float .1
defaults write com.apple.dock springboard-page-duration -float .2

# In Safari, don't send search queries to Apple
sudo defaults write com.apple.Safari UniversalSearchEnabled -bool false
sudo defaults write com.apple.Safari SuppressSearchSuggestions -bool true

# In Safari, show full URLs always
sudo defaults write com.apple.Safari ShowFullURLInSmartSearchField -bool true

# Increase file limits
sudo sysctl kern.maxfiles=64000 kern.maxfilesperproc=28000

brew bundle install --cleanup --file=~/.config/Brewfile

$(brew --prefix)/opt/fzf/install

# Setup brew autoupdate (every 12 hours)
brew autoupdate start 43200

# Programming language stuff
mise plugin install yarn
mise plugin install pnpm
ERL_AFLAGS="-kernel shell_history enabled" \
JEMALLOC_LIBS="-L$(brew --prefix jemalloc)/lib -ljemalloc" \
JEMALLOC_CFLAGS="-I$(brew --prefix jemalloc)/include" \
CPPFLAGS="-I$(brew --prefix jemalloc)/include -I$(brew --prefix gmp)/include -I$(xcrun --show-sdk-path)/usr/include -I$(brew --prefix sqlite)/include" \
LDFLAGS="-L$(brew --prefix jemalloc)/lib -L$(brew --prefix gmp)/lib -L$(xcrun --show-sdk-path)/usr/lib -L$(brew --prefix sqlite)/lib" \
PKG_CONFIG_PATH="$(brew --prefix gmp)/lib/pkgconfig:$(brew --prefix jemalloc)/lib/pkgconfig:$PKG_CONFIG_PATH" \
RUBY_CONFIGURE_OPTS="--with-gmp --with-jemalloc" \
  mise use -g node@lts \
              bun@latest \
              pnpm@latest \
              yarn@latest \
              ruby@latest \
              go@latest \
              python@latest \
              erlang@latest \
              elixir@latest \
              zig@latest \
              zls@latest \
              watchexec@latest \
              gleam@latest

mix local.hex --force

pip install "reladiff[all]" "shandy-sqlfmt[jinjafmt]"
