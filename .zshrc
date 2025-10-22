PATH="$HOME/.bin:/opt/homebrew/opt/sqlite/bin:/opt/homebrew/opt/libpq/bin:/opt/homebrew/opt/gnu-tar/libexec/gnubin:$PATH"
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
export MIX_OS_DEPS_COMPILE_PARTITION_COUNT=$(sysctl -n hw.perflevel0.logicalcpu 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || nproc --all 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)
export JEMALLOC_LIBS="-L$(brew --prefix jemalloc)/lib -ljemalloc"
export JEMALLOC_CFLAGS="-I$(brew --prefix jemalloc)/include"
export CPPFLAGS="-I$(brew --prefix openssl@3)/include -I$(brew --prefix jemalloc)/include -I$(brew --prefix gmp)/include -I$(xcrun --show-sdk-path)/usr/include -I$(brew --prefix sqlite)/include"F
export LDFLAGS="-L$(brew --prefix openssl@3)/lib -L$(brew --prefix jemalloc)/lib -L$(brew --prefix gmp)/lib -L$(xcrun --show-sdk-path)/usr/lib -L$(brew --prefix sqlite)/lib"
export PKG_CONFIG_PATH="$(brew --prefix openssl@3)/lib/pkgconfig:$(brew --prefix gmp)/lib/pkgconfig:$(brew --prefix jemalloc)/lib/pkgconfig:$PKG_CONFIG_PATH"
export RUBY_CONFIGURE_OPTS="--with-gmp --with-jemalloc"
export BUNDLE_IGNORE_FUNDING_REQUESTS=YES
export PGGSSENCMODE=disable
export EDITOR="zed"
# Useful for multiline editing in iex using Esc+O (https://bsky.app/profile/bobbby.online/post/3llwpqtwwf22r)
export VISUAL="zed -n -w"
export PSQL_EDITOR="zed -n -w"
export KUBE_EDITOR="zed -n -w"
export ERL_AFLAGS="-kernel shell_history enabled"
export FZF_DEFAULT_OPTS="--color=light"
export PAGER="less -S"

set -a
source "$HOME/.env"
set +a

[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

#### History

export HISTFILE=$HOME/.zsh_history
export HISTSIZE=10000000
export SAVEHIST=10000000
export HISTORY_IGNORE="(ls|cd|pwd|exit|cd|mv|rm)*"

# Immediately append to history file:
setopt INC_APPEND_HISTORY

# Record timestamp in history:
setopt EXTENDED_HISTORY

# Expire duplicate entries first when trimming history:
setopt HIST_EXPIRE_DUPS_FIRST

# Dont record an entry that was just recorded again:
setopt HIST_IGNORE_DUPS

# Delete old recorded entry if new entry is a duplicate:
setopt HIST_IGNORE_ALL_DUPS

# Do not display a line previously found:
setopt HIST_FIND_NO_DUPS

# Dont record an entry starting with a space:
setopt HIST_IGNORE_SPACE

# Dont write duplicate entries in the history file:
setopt HIST_SAVE_NO_DUPS

# Share history between all sessions:
setopt SHARE_HISTORY

# Execute commands using history (e.g.: using !$) immediatel:
unsetopt HIST_VERIFY

#### Completions

fpath+="$(brew --prefix)/share/zsh/site-functions"
fpath+="$HOME/.zfunc"
autoload -Uz compinit && compinit
zmodload zsh/complist
zstyle ':completion:*' menu select
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}'

eval "$(mise activate zsh)"

source /opt/homebrew/opt/git-extras/share/git-extras/git-extras-completion.zsh
source "$(brew --prefix)/share/google-cloud-sdk/path.zsh.inc"
source "$(brew --prefix)/share/google-cloud-sdk/completion.zsh.inc"
source <(jj util completion zsh)
eval "$(zoxide init zsh)"

#### Keybinds

bindkey '^[3~' backward-kill-word # option-backspace
bindkey '^[[3;3~' kill-word # option-fn-backspace
bindkey '^[[1;3D' backward-word # option-left
bindkey '^[[1;3C' forward-word # option-right
bindkey '^[[1;9D' beginning-of-line # cmd-left
bindkey '^[[1;9C' end-of-line # cmd-right
bindkey -M menuselect '^[[Z' reverse-menu-complete

#### Prompt

setopt PROMPT_SUBST
PS1='%F{green}%~%f %# '


#### Aliases

alias ls='ls --color=auto'
alias ll='ls -lh'
alias la='ls -A'
alias lla='ls -Alh'

alias ..='cd ..'
alias ...='cd ../..'
alias ....='cd ../../..'

alias grep='grep --color=auto'
alias fgrep='fgrep --color=auto'
alias egrep='egrep --color=auto'

alias tmp='mkdir /tmp/$$ ; cd /tmp/$$'
alias rmtmp='rm -rf /tmp/$$'

alias tree='tree -C'
alias pager='less -cRS'

alias marked="open -a Marked"

#### Functions

function tailscale() {
 /Applications/Tailscale.app/Contents/MacOS/Tailscale "$@"
}

function g() {
  git "$@"
}

function e() {
  $EDITOR "$@"
}

function s() {
  subl "$@"
}

function gti() {
  git "$@"
}

function dcleanup() {
  docker system prune --all --volumes --force "$@"
}

function dc() {
  docker compose "$@"
}

function egm() {
  git modified | xargs $EDITOR
}

function todo() {
  grep \
    --exclude-dir=public \
    --exclude-dir=tmp \
    --exclude-dir=vendor \
    --exclude-dir=node_modules \
    --exclude=\*.log \
    --text \
    --color \
    -nRo 'TODO.*:.*\|FIXME.*:.*\|HACK.*:.*\|OPTIMIZE.*:.*' .
}

function convert_mp4_to_mov() {
  rm "$1.mov"
  touch -r "$1.mp4" "$1.mov"
  ffmpeg -i "$1.mp4" -movflags use_metadata_tags -map_metadata 0 -f mov "$1.mov"
}

function livebook-install() {
  mix do local.rebar --force, local.hex --force
  mix escript.install hex livebook
}

function git-fetch-all-repos() {
  find . -type d -depth 1 -exec git --git-dir={}/.git --work-tree=$PWD/{} pull --all \;
  find . -type d -depth 1 -exec git --git-dir={}/.git --work-tree=$PWD/{} fetch origin master:master \;
  find . -type d -depth 1 -exec git --git-dir={}/.git --work-tree=$PWD/{} fetch origin main:main \;
}

function update-programming-languages() {
  mise cache clear
  mise plugins up
  mise up --bump
  mise reshim
  pip install "reladiff[all]" "shandy-sqlfmt[jinjafmt]"
  mix local.hex --force
}

function update-everything() {
  brew update && brew bundle install --cleanup --file=~/.config/Brewfile && brew upgrade && update-programming-languages
}

function nosleep() {
  caffeinate -isd
}

function sxr8() {
  curl -s "https://www.tradegate.de/refresh.php?isin=IE00B5BMR087" | \
  jq -r '["Bid", "Ask", "Mid", "Spread"] as $headers |
        ([.bid, .ask] | map(if type == "string" then gsub(",";".") | tonumber else . end)) as [$bid, $ask] |
        [$headers,
          [$bid, $ask, ($bid + $ask) / 2, (($ask / $bid - 1) * 100)]
        ] | .[] | join("\t")' | \
  awk -F'\t' 'NR==1 {printf "%-8s %-8s %-8s %-8s\n", $1, $2, $3, $4}
              NR==2 {printf "%-8.2f %-8.2f %-8.2f %-8.2f\n", $1, $2, $3, $4}'
}

function sxr8_no_header() {
  curl -s "https://www.tradegate.de/refresh.php?isin=IE00B5BMR087" | \
  jq -r '([.bid, .ask] | map(if type == "string" then gsub(",";".") | tonumber else . end)) as [$bid, $ask] |
        [$bid, $ask,
        ($bid + $ask) / 2,
        (($ask / $bid - 1) * 100)] |
        join("\t")' | \
  awk -F'\t' '{printf "%-8.2f %-8.2f %-8.2f %-8.2f\n", $1, $2, $3, $4}'
}

function sxr8loop() {
  sxr8
  sleep 1;
  for w in {1..9}; do
    sxr8_no_header;
    sleep 1;
  done
}

function sppw() {
  curl -s "https://www.tradegate.de/refresh.php?isin=IE00BFY0GT14" | \
  jq -r '["Bid", "Ask", "Mid", "Spread"] as $headers |
        ([.bid, .ask] | map(if type == "string" then gsub(",";".") | tonumber else . end)) as [$bid, $ask] |
        [$headers,
          [$bid, $ask, ($bid + $ask) / 2, (($ask / $bid - 1) * 100)]
        ] | .[] | join("\t")' | \
  awk -F'\t' 'NR==1 {printf "%-8s %-8s %-8s %-8s\n", $1, $2, $3, $4}
              NR==2 {printf "%-8.2f %-8.2f %-8.2f %-8.2f\n", $1, $2, $3, $4}'
}

function sppw_no_header() {
  curl -s "https://www.tradegate.de/refresh.php?isin=IE00BFY0GT14" | \
  jq -r '([.bid, .ask] | map(if type == "string" then gsub(",";".") | tonumber else . end)) as [$bid, $ask] |
        [$bid, $ask,
        ($bid + $ask) / 2,
        (($ask / $bid - 1) * 100)] |
        join("\t")' | \
  awk -F'\t' '{printf "%-8.2f %-8.2f %-8.2f %-8.2f\n", $1, $2, $3, $4}'
}

function sppwloop() {
  sppw
  sleep 1;
  for w in {1..9}; do
    sppw_no_header;
    sleep 1;
  done
}

function mkcd () {
  \mkdir -p "$1"
  cd "$1"
}

function tempe () {
  cd "$(mktemp -d)"
  chmod -R 0700 .
  if [[ $# -eq 1 ]]; then
    \mkdir -p "$1"
    cd "$1"
    chmod -R 0700 .
  fi
}
