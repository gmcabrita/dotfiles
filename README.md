# dotfiles

## On previous machine

- `cp ~/.zsh_history ~/iCloud\ Drive/Software/.zsh_history`
- Export iStat Menu settings
- Export Raycast settings

## Pre-install script setup

- Privacy & Security:
  - Enable full disk access for Terminal
- Accessibility:
  - Increase Text size to 16pt for supported apps
- Display:
  - Disable "Automatically adjust brightness"
- Battery:
  - Disable "Slightly dim the display while on battery power"
  - Wake for network access: "Never"
- Notifications:
  - Allow notifications when the display is sleeping: No
- Keyboard:
  - Swap fn and ctrl
  - Press globe key to: "Do nothing"
  - App Shortcuts
    - Apple Notes
      - Note List Search... = `⌘ P`
  - Input Sources > Edit
    - Disable everything
- Trackpad:
  - Disable "Look up & data detectors"
- Desktop & Dock
  - Window Tiling
    - Disable "Tiled windows have margins"
- Change DNS
  - 8.8.8.8
  - 8.8.4.4
  - 2001:4860:4860::8888
  - 2001:4860:4860::8844
- Wallpaper:
  - Custom color: #000000
- `./install.zsh`

## Post-install script setup

- https://github.com/Gaulomatic/AirPodsSanity
  - Configure it
- Chrome
  - Configure 1Password
    - Show autofill menu on field focus: No
    - Sign in automatically after autofill: No
  - uBlacklist import from Google Drive
- 1Password
- `gh auth login`
  - Add ssh key as gpg key
- Orbstack
- Slack
- Discord
- WhatsApp
- Monodraw
- NetNewsWire
- Raycast
  - Disable spotlight
  - Import config from iCloud Drive (or login if we still have Pro)
- Zoom
- Setapp + apps
  - CleanShot X
  - TablePlus
  - Soulver
  - CleanMyMac X
  - iStat Menus
    - Import config from iCloud Drive
  - Proxyman
- https://twitter.com/thorstenball/status/1736679960784310775
  - Keep "Wake for network access" on because of Plex
- Copy zsh history from icloud
  - `cp ~/iCloud\ Drive/Software/.zsh_history ~/.zsh_history`
- Finder settings:
  - Remove favorites:
    - Pictures
    - Tags
    - Music
    - AirDrop
  - Date modified, simple date
  - Display as List
  - Show Path Bar
  - Show Status Bar
  - Configure Tool Bar:
    - Remove tags
    - Remove groups
    - Remove get info
    - Add AirDrop
    - Customize Share button
  - Finder settings > Advanced
    - Show all filename extensions
    - Show warning before emptying the Trash
    - Remove items from the Trash after 30 days
    - Keep folders on top when sorting by name
    - When performing a search: Search the Current Folder
