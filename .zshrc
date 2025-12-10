[[ $ZPROF == 1 ]] && zmodload zsh/zprof

# Cache expensive lookups
HOMEBREW_PREFIX="${HOMEBREW_PREFIX:-/opt/homebrew}"
# Cache xcrun result to avoid fork on every shell startup (~5ms savings)
if [[ -z "$MACOS_SDK_PATH" ]]; then
  if [[ -f ~/.cache/macos_sdk_path ]]; then
    MACOS_SDK_PATH="$(<~/.cache/macos_sdk_path)"
  else
    MACOS_SDK_PATH="$(xcrun --show-sdk-path 2>/dev/null)"
    mkdir -p ~/.cache && printf '%s' "$MACOS_SDK_PATH" > ~/.cache/macos_sdk_path
  fi
fi

PATH="$HOME/.local/bin:$HOMEBREW_PREFIX/opt/sqlite/bin:$HOMEBREW_PREFIX/opt/libpq/bin:$HOMEBREW_PREFIX/opt/gnu-tar/libexec/gnubin:$PATH"
export HOMEBREW_CLEANUP_MAX_AGE_DAYS=30
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
export HK_MISE=1
# export MIX_OS_DEPS_COMPILE_PARTITION_COUNT=$(sysctl -n hw.perflevel0.logicalcpu 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || nproc --all 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)
export JEMALLOC_LIBS="-L$HOMEBREW_PREFIX/opt/jemalloc/lib -ljemalloc"
export JEMALLOC_CFLAGS="-I$HOMEBREW_PREFIX/opt/jemalloc/include"
export CPPFLAGS="-I$HOMEBREW_PREFIX/opt/openssl@3/include -I$HOMEBREW_PREFIX/opt/jemalloc/include -I$HOMEBREW_PREFIX/opt/gmp/include -I$MACOS_SDK_PATH/usr/include -I$HOMEBREW_PREFIX/opt/sqlite/include"
export LDFLAGS="-L$HOMEBREW_PREFIX/opt/openssl@3/lib -L$HOMEBREW_PREFIX/opt/jemalloc/lib -L$HOMEBREW_PREFIX/opt/gmp/lib -L$MACOS_SDK_PATH/usr/lib -L$HOMEBREW_PREFIX/opt/sqlite/lib"
export PKG_CONFIG_PATH="$HOMEBREW_PREFIX/opt/openssl@3/lib/pkgconfig:$HOMEBREW_PREFIX/opt/gmp/lib/pkgconfig:$HOMEBREW_PREFIX/opt/jemalloc/lib/pkgconfig:$PKG_CONFIG_PATH"
export RUBY_CONFIGURE_OPTS="--with-gmp --with-jemalloc"
export BUNDLE_IGNORE_FUNDING_REQUESTS=YES
export PGGSSENCMODE=disable
export EDITOR="zed"
export RAILS_EDITOR="zed"
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

# fzf: load key-bindings immediately, lazy-load completion
if [[ ! "$PATH" == *$HOMEBREW_PREFIX/opt/fzf/bin* ]]; then
  PATH="${PATH:+${PATH}:}$HOMEBREW_PREFIX/opt/fzf/bin"
fi
source ~/.zsh_cache/fzf-key-bindings.zsh

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

#### Completions (lazy-loaded on first tab)

fpath+="$HOMEBREW_PREFIX/share/zsh/site-functions"
fpath+="$HOME/.zfunc"

function __init_completions() {
  unfunction __init_completions
  autoload -Uz compinit
  if [[ ! -f ~/.zcompdump ]] || [[ $(find ~/.zcompdump -mtime +1 2>/dev/null) ]]; then
    compinit
    zcompile ~/.zcompdump
  else
    compinit -C
  fi
  [[ ~/.zcompdump.zwc -nt ~/.zcompdump ]] || zcompile ~/.zcompdump
  zmodload zsh/complist
  zstyle ':completion:*' menu select
  zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}'
  bindkey -M menuselect '^[[Z' reverse-menu-complete
  # Load deferred completions
  source $HOMEBREW_PREFIX/opt/git-extras/share/git-extras/git-extras-completion.zsh
  source "$HOMEBREW_PREFIX/opt/fzf/shell/completion.zsh"
}

# Defer compinit until first tab press
function __expand_or_complete_with_init() {
  __init_completions
  bindkey '^I' expand-or-complete
  zle expand-or-complete
}
zle -N __expand_or_complete_with_init
bindkey '^I' __expand_or_complete_with_init

export PATH="$HOME/.local/share/mise/shims:$PATH"

# gcloud path (inlined from path.zsh.inc)
export PATH="$HOMEBREW_PREFIX/share/google-cloud-sdk/bin:$PATH"
# Cache zoxide init (regenerate with: zoxide init zsh > ~/.zoxide.zsh)
source ~/.zoxide.zsh

function gcloud() {
  unfunction gcloud gsutil bq
  source "$HOMEBREW_PREFIX/share/google-cloud-sdk/completion.zsh.inc"
  command gcloud "$@"
}
function gsutil() {
  unfunction gcloud gsutil bq
  source "$HOMEBREW_PREFIX/share/google-cloud-sdk/completion.zsh.inc"
  command gsutil "$@"
}
function bq() {
  unfunction gcloud gsutil bq
  source "$HOMEBREW_PREFIX/share/google-cloud-sdk/completion.zsh.inc"
  command bq "$@"
}

#### Keybinds

bindkey '^[3~' backward-kill-word # option-backspace
bindkey '^[[3;3~' kill-word # option-fn-backspace
bindkey '^[[1;3D' backward-word # option-left
bindkey '^[[1;3C' forward-word # option-right
bindkey '^[[1;9D' beginning-of-line # cmd-left
bindkey '^[[1;9C' end-of-line # cmd-right

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

alias vi="nvim"
alias vim="nvim"

#### Functions

# Lazy-load jj completion
function jj() {
  unfunction jj
  # source <(command jj util completion zsh)
  command jj "$@"
}

function profile-zsh() {
  ZPROF=1 zsh -i -c exit
}

function benchmark-zsh() {
  hyperfine --warmup 10 "zsh -i -c 'exit 0'"
}

function tailscale() {
 /Applications/Tailscale.app/Contents/MacOS/Tailscale "$@"
}

function g() {
  git "$@"
}

function claudeyolo() {
  claude --dangerously-skip-permissions "$@"
}

function t() {
  gtime -v "$@" 2>&1 | awk '
      function fmt_2dec_or_int(val,    r) {
          r = sprintf("%.2f", val) + 0
          s = sprintf("%.2f", r)
          sub(/\.00$/, "", s)
          sub(/\.0$/,  "", s)
          return s
      }
      function humanize_kib(kb,    units, i, val, v) {
          units[0]="KiB"; units[1]="MiB"; units[2]="GiB"; units[3]="TiB"
          val = kb + 0
          i = 0
          while (val >= 1024 && i < 3) { val /= 1024; i++ }
          v = fmt_2dec_or_int(val)
          return sprintf("%s %s", v, units[i])
      }

      /\(kbytes\)/ {
          line = $0
          if (match(line, /[0-9]+([.][0-9]+)?[[:space:]]*$/)) {
              lhs = substr(line, 1, RSTART - 1)
              num = substr(line, RSTART, RLENGTH)
              gsub(/^[[:space:]]+|[[:space:]]+$/, "", num)
              kb = num + 0
              gsub(/ \(kbytes\)/, "", lhs)
              printf "%s%s\n", lhs, humanize_kib(kb)
              next
          }
      }

      { print }
  '
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
  rg --color=always -n -a -o \
    -g '!public/**' -g '!tmp/**' -g '!vendor/**' -g '!node_modules/**' -g '!**/*.log' \
    'TODO.*:.*|FIXME.*:.*|HACK.*:.*|OPTIMIZE.*:.*'
}

function nocheckin() {
  rg --color=always -n -a -o -i \
    -g '!public/**' -g '!tmp/**' -g '!vendor/**' -g '!node_modules/**' -g '!**/*.log' \
    'NOCHECKIN.*:?.*'
}

function convert_mp4_to_mov() {
  rm "$1.mov"
  touch -r "$1.mp4" "$1.mov"
  ffmpeg -i "$1.mp4" -movflags use_metadata_tags -map_metadata 0 -f mov "$1.mov"
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
}

function update-everything() {
  brew update && brew bundle install --cleanup --file=~/.config/Brewfile && brew upgrade && update-programming-languages

  echo "Remember that these exist:"
  echo "\tdoggo            DNS Client"
  echo "\toha              HTTP load generator"
  echo "\tspacer           Utility for adding spacers when command output stops"
  echo "\tt                Time program (Clocks, RSS, Context Switches)"
  echo "\ttspin            Log file highlighter"
  echo "\tbenchmark-zsh    Benchmark ZSH startup"
  echo "\tprofile-zsh      Profile ZSH startup"
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

function oplogin() {
  eval $(op signin)
}

function sound-done() {
  (afplay /System/Library/Sounds/Submarine.aiff &>/dev/null &)
}

function sound-prompt() {
  (afplay /System/Library/Sounds/Ping.aiff &>/dev/null &)
}

[[ $ZPROF == 1 ]] && zprof
