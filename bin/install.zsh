#!/usr/bin/env bash

source bin/copy-dotfiles.sh

mkdir ~/.zfunc

# iCloud Drive symlink
ln -s "$HOME/Library/Mobile Documents/com~apple~CloudDocs" "$HOME/iCloud Drive"

# Brew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Rosetta
/usr/sbin/softwareupdate --install-rosetta --agree-to-license

# Set hostname
vared -p "Computer name: " -c name
# shellcheck disable=SC2154
LOCALHOSTNAME=$(echo "$name" | sed -e "y/ç'’ /c---/")
sudo scutil --set ComputerName "$name"
sudo scutil --set HostName "$name"
sudo scutil --set LocalHostName "$LOCALHOSTNAME"
sudo defaults write /Library/Preferences/SystemConfiguration/com.apple.smb.server NetBIOSName -string "$name"

# Battery
sudo pmset -a lowpowermode 0
sudo pmset -b lessbright 0
sudo pmset -b tcpkeepalive 1
sudo pmset -b womp 0
sudo pmset -c tcpkeepalive 1
sudo pmset -c womp 1

# Touchpad
defaults write com.apple.AppleMultitouchTrackpad Clicking -bool false
defaults write com.apple.driver.AppleBluetoothMultitouch.trackpad Clicking -bool false
defaults -currentHost write NSGlobalDomain com.apple.mouse.tapBehavior -int 0

# Google DNS
networksetup -listallnetworkservices | sed 1d | sed '/^\*/d' | while IFS= read -r service; do
    networksetup -setdnsservers "$service" 8.8.8.8 8.8.4.4 2001:4860:4860::8888 2001:4860:4860::8844
done

# Pointer settings
defaults write NSGlobalDomain CGDisableCursorLocationMagnification -bool false
defaults write com.apple.universalaccess mouseDriverCursorSize -float 1.5

# Show Library folder
chflags nohidden ~/Library

# Show advanced printing settings by default
defaults write NSGlobalDomain PMPrintingExpandedStateForPrint -bool true
defaults write NSGlobalDomain PMPrintingExpandedStateForPrint2 -bool true

# Disable all animations
defaults write NSGlobalDomain DisableAllAnimations -bool true
defaults write NSGlobalDomain NSAutomaticWindowAnimationsEnabled -bool false
defaults write NSGlobalDomain NSScrollAnimationEnabled -bool false
defaults write NSGlobalDomain QLPanelAnimationDuration -float 0
defaults write NSGlobalDomain NSScrollViewRubberbanding -bool false
defaults write NSGlobalDomain NSDocumentRevisionsWindowTransformAnimation -bool false
defaults write NSGlobalDomain NSToolbarFullScreenAnimationDuration -float 0
defaults write NSGlobalDomain NSBrowserColumnAnimationSpeedMultiplier -float 0
defaults write com.apple.finder DisableAllAnimations -bool true
defaults write com.apple.dock no-bouncing -bool true
defaults write com.apple.dock launchanim -bool false
defaults write com.apple.dock springboard-show-duration -float 0
defaults write com.apple.dock springboard-hide-duration -float 0
defaults write com.apple.dock springboard-page-duration -float 0
defaults write com.apple.dock mineffect -string "scale"
defaults write com.apple.dock autohide -bool true
defaults write com.apple.dock autohide-delay -int 1000
defaults write com.apple.dock autohide-time-modifier -float 0
defaults write com.apple.Accessibility ReduceMotionEnabled -bool true
defaults write com.apple.universalaccess reduceMotion -bool true

# Enable full keyboard access for all controls (Accessibility pane)
defaults write NSGlobalDomain AppleKeyboardUIMode -int 3

# Press-and-hold should repeat the key, not pop a dialog for special keys.
defaults write NSGlobalDomain ApplePressAndHoldEnabled -bool false

# Disable minimizing windows with cmd+m
defaults write NSGlobalDomain NSUserKeyEquivalents -dict-add 'Minimize' '\0'

# Enable moving window with ctrl+cmd+click
defaults write NSGlobalDomain NSWindowShouldDragOnGesture -bool true

# Fast keyboard repeat rate
defaults write NSGlobalDomain KeyRepeat -int 1
defaults write NSGlobalDomain InitialKeyRepeat -int 10

# Enable F1, etc by default
defaults write NSGlobalDomain com.apple.keyboard.fnState -bool true

# Disable autocapitalize
defaults write NSGlobalDomain NSAutomaticCapitalizationEnabled -bool false

# Disable autocorrect
defaults write NSGlobalDomain NSAutomaticSpellingCorrectionEnabled -bool false

# Disable period substitution
defaults write NSGlobalDomain NSAutomaticPeriodSubstitutionEnabled -bool false

# Disable smart quotes and dashes
defaults write NSGlobalDomain NSAutomaticDashSubstitutionEnabled -bool false

# Same, but for Apple Notes
defaults write com.apple.Notes ShouldCorrectSpellingAutomatically -bool false
defaults write com.apple.Notes ShouldUseSmartDashes -bool false
defaults write com.apple.Notes ShouldUseSmartQuotes -bool false

# Disable text replacements
defaults write NSGlobalDomain NSUserDictionaryReplacementItems -array

# Set Zed as the default editor for plaintext files
defaults write com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers -array-add \
  '{LSHandlerContentType=public.plain-text;LSHandlerRoleAll=dev.zed.Zed;}' \
  '{LSHandlerContentType=public.unix-executable;LSHandlerRoleAll=dev.zed.Zed;}' \
  '{LSHandlerContentType=public.data;LSHandlerRoleAll=dev.zed.Zed;}'


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
defaults write NSGlobalDomain AppleShowAllFiles -bool true
defaults write NSGlobalDomain AppleShowAllExtensions -bool true
defaults write NSGlobalDomain ShowStatusBar -bool true
defaults write NSGlobalDomain ShowPathbar -bool true

# Finder trash settings
defaults write com.apple.finder WarnOnEmptyTrash -bool true
defaults write com.apple.finder FXRemoveOldTrashItems -bool true

# Don't warn when changing a file extension
defaults write NSGlobalDomain FXEnableExtensionChangeWarning -bool false

# Use column view by default
defaults write NSGlobalDomain FXPreferredViewStyle -string "clmv"
defaults write com.apple.finder FXDefaultSearchScope -string "SCcf"

# Keep folders on top when sorting by name
defaults write NSGlobalDomain _FXSortFoldersFirst -bool true
defaults write NSGlobalDomain _FXSortFoldersFirstOnDesktop -bool true

# Hide desktop icons
defaults write NSGlobalDomain CreateDesktop -bool false

# Expanded Save and Print dialogs by default
defaults write NSGlobalDomain NSNavPanelExpandedStateForSaveMode -bool true
defaults write NSGlobalDomain PMPrintingExpandedStateForPrint -bool true
defaults write NSGlobalDomain PMPrintingExpandedStateForPrint2 -bool true

# Save to disk, rather than iCloud, by default
defaults write NSGlobalDomain NSDocumentSaveNewDocumentsToCloud -bool false

# Disable Tahoe menu icons
defaults write NSGlobalDomain NSMenuEnableActionImages -bool false

# Wipe all default app icons from the dock
defaults write com.apple.dock persistent-apps -array

# Set Dock icon size to 64 pixels
defaults write com.apple.dock tilesize -float 64

# Dock on the right
defaults write com.apple.dock orientation -string "right"

# In Safari, don't send search queries to Apple
defaults write com.apple.Safari UniversalSearchEnabled -bool false
defaults write com.apple.Safari SuppressSearchSuggestions -bool true

# In Safari, show full URLs always
defaults write com.apple.Safari ShowFullURLInSmartSearchField -bool true

# Increase file limits
sudo sysctl kern.maxfiles=64000 kern.maxfilesperproc=28000

# Check for software updates daily, not just once per week
defaults write com.apple.SoftwareUpdate ScheduleFrequency -int 1

# Avoid creating .DS_Store files on network volumes
defaults write com.apple.desktopservices DSDontWriteNetworkStores -bool true

# Sort users in Contacts by first name
defaults write -app Contacts ABNameSortingFormat -string "sortingFirstName sortingLastName"

brew bundle install --cleanup --file=~/.config/Brewfile

"$(brew --prefix)/opt/fzf/install"

# Setup brew autoupdate (every 12 hours)
brew autoupdate start 43200

# Programming language stuff
mise plugin install pnpm
mise plugin install odin
mise settings add idiomatic_version_file_enable_tools rust
mise settings set python.uv_venv_auto true
mise settings set npm.package_manager pnpm
mise settings ruby.compile=false
ERL_AFLAGS="-kernel shell_history enabled" \
JEMALLOC_LIBS="-L$(brew --prefix jemalloc)/lib -ljemalloc" \
JEMALLOC_CFLAGS="-I$(brew --prefix jemalloc)/include" \
CPPFLAGS="-I$(brew --prefix openssl@3)/include -I$(brew --prefix jemalloc)/include -I$(brew --prefix gmp)/include -I$(xcrun --show-sdk-path)/usr/include -I$(brew --prefix sqlite)/include"F \
LDFLAGS="-L$(brew --prefix openssl@3)/lib -L$(brew --prefix jemalloc)/lib -L$(brew --prefix gmp)/lib -L$(xcrun --show-sdk-path)/usr/lib -L$(brew --prefix sqlite)/lib" \
PKG_CONFIG_PATH="$(brew --prefix openssl@3)/lib/pkgconfig:$(brew --prefix gmp)/lib/pkgconfig:$(brew --prefix jemalloc)/lib/pkgconfig:$PKG_CONFIG_PATH" \
RUBY_CONFIGURE_OPTS="--with-gmp --with-jemalloc" \
  mise use -g cargo:hurlfmt@latest \
              cargo:oha@latest \
              deno@latest \
              elixir@latest \
              erlang@latest \
              fnox@latest \
              github:lexiforest/curl-impersonate \
              github:rockorager/ziglint \
              go@latest \
              hk@latest \
              node@lts \
              npm:@mariozechner/pi-coding-agent@latest \
              npm:hunkdiff@latest \
              npm:portless@latest \
              npm:@kitlangton/ghui@latest \
              odin@latest \
              pitchfork@latest \
              pkl@latest \
              pnpm@latest \
              python@latest \
              ruby@latest \
              rust@latest \
              uv@latest \
              watchexec@latest \
              zig@latest \
              zls@latest

go install golang.org/x/tools/gopls@latest
mix local.hex --force
