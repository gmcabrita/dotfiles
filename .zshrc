[[ $ZPROF == 1 ]] && zmodload zsh/zprof

# Cache expensive lookups
HOMEBREW_PREFIX="${HOMEBREW_PREFIX:-/opt/homebrew}"
# Cache xcrun result to avoid fork on every shell startup (~5ms savings)
if [[ -z "$MACOS_SDK_PATH" ]]; then
  if [[ -f ~/.cache/macos_sdk_path ]]; then
    MACOS_SDK_PATH="$(<~/.cache/macos_sdk_path)"
  else
    mkdir -p ~/.cache
    xcrun --show-sdk-path 2>/dev/null > ~/.cache/macos_sdk_path
    MACOS_SDK_PATH="$(<~/.cache/macos_sdk_path)"
  fi
fi

PATH="$HOME/.bun/bin:$HOME/.amp/bin:$HOME/.local/bin:$HOMEBREW_PREFIX/opt/sqlite/bin:$HOMEBREW_PREFIX/opt/libpq/bin:$HOMEBREW_PREFIX/opt/gnu-tar/libexec/gnubin:$PATH"
export HOMEBREW_CLEANUP_MAX_AGE_DAYS=30
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
export HK_MISE=1
export OPENCODE_EXPERIMENTAL_LSP_TOOL=1
export OPENCODE_EXPERIMENTAL_PLAN_MODE=1
export MIX_OS_DEPS_COMPILE_PARTITION_COUNT=$(sysctl -n hw.perflevel0.logicalcpu 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || nproc --all 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)
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

#### Other ZSH Autoloads

autoload -Uz edit-command-line
zle -N edit-command-line

# zmv '(*).log' '$1.txt'
# zmv -n -W '*.log' '*.txt'
# zmv -i -W '*.log' '*.txt'
autoload zmv

#### Keybinds

bindkey '^x^e' edit-command-line
bindkey '^_' undo

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
alias oc="opencode"

alias -s json='jless'
alias -s jsonl='jless'
alias -s ndjson='jless'
alias -s gz='(){ if [[ "$1" == *.json.gz || "$1" == *.jsonl.gz || "$1" == *.ndjson.gz ]]; then gunzip -c "$1" | jless; else gunzip -c "$1"; fi }'

alias -g NE='2>/dev/null'
alias -g DN='> /dev/null'
alias -g NUL='>/dev/null 2>&1'
alias -g C='| pbcopy'
alias -g L='| less'

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
  amp update
  mix local.hex --force
  rm -rf "$HOME/Library/Application Support/Zed/extensions/work/elixir"/expert-*(N)
}

function timestamps() {
  ts '[%Y-%m-%d %H:%M:%.S]'
}

function update-everything() {
  brew update
  brew bundle install --cleanup --file=~/.config/Brewfile
  brew upgrade
  update-programming-languages
  rm -f ~/.cache/macos_sdk_path
  mole clean

  echo "Remember that these exist:"
  echo "\tdoggo            DNS Client"
  echo "\tgsa              Analyze the size of Go binaries"
  echo "\toha              HTTP load generator"
  echo "\tspacer           Utility for adding spacers when command output stops"
  echo "\tt                Time program (Clocks, RSS, Context Switches)"
  echo "\ttspin            Log file highlighter"
  echo "\tmo               Deep clean and optimize your Mac"
  echo "\tbenchmark-zsh    Benchmark ZSH startup"
  echo "\tprofile-zsh      Profile ZSH startup"
}

function nosleep() {
  caffeinate -isd
}

# Generic tradegate quote fetcher
function _tradegate_quote() {
  local isin=$1 header=${2:-1}
  curl -s "https://www.tradegatebsx.com/refresh.php?isin=$isin" | \
  jq -r --argjson h "$header" '
    ([.bid, .ask] | map(if type == "string" then gsub(",";".") | tonumber else . end)) as [$bid, $ask] |
    if $h == 1 then
      (["Bid", "Ask", "Mid", "Spread"], [$bid, $ask, ($bid + $ask) / 2, (($ask / $bid - 1) * 100)]) | @tsv
    else
      [$bid, $ask, ($bid + $ask) / 2, (($ask / $bid - 1) * 100)] | @tsv
    end' | \
  awk -F'\t' 'NR==1 && /Bid/ {printf "%-8s %-8s %-8s %-8s\n", $1, $2, $3, $4; next}
              {printf "%-8.2f %-8.2f %-8.2f %-8.2f\n", $1, $2, $3, $4}'
}

function _tradegate_loop() {
  local isin=$1
  _tradegate_quote "$isin" 1
  for _ in {1..9}; do sleep 1; _tradegate_quote "$isin" 0; done
}

# ETF aliases
function sxr8() { _tradegate_quote IE00B5BMR087 1; }
function sxr8loop() { _tradegate_loop IE00B5BMR087; }
function sppw() { _tradegate_quote IE00BFY0GT14 1; }
function sppwloop() { _tradegate_loop IE00BFY0GT14; }
function uetw() { _tradegate_quote IE00BD4TXV59 1; }
function uetwloop() { _tradegate_loop IE00BD4TXV59; }

function mkcd() {
  \mkdir -p "$1"
  cd "$1"
}

function tempe() {
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

# Create a new clone and branch for parallel development.
# Usage: ga <branch-name> [base-branch]
function ga() {
  if [[ -z "$1" ]]; then
    echo "Usage: ga <branch-name> [base-branch]"
    return 1
  fi
  local branch="$1"
  local repo_name="$(basename "$PWD")"
  local repo_url="$(git remote get-url origin)"
  local clone_path="../${repo_name}-${branch}"

  # Use fzf to select base branch, defaulting to main
  local base_branch="$(git branch -r --format='%(refname:short)' | sed 's|origin/||' | fzf --height=20 --prompt='Select base branch: ' --query="main")"

  # If fzf was cancelled, fall back to main
  if [[ -z "$base_branch" ]]; then
    base_branch="main"
  fi

  echo "Creating clone at $clone_path from $base_branch..."

  # Clone with reference to current repo for speed/space savings
  git clone --reference "$PWD" "$repo_url" "$clone_path"

  # Enter clone and set up branch
  cd "$clone_path"
  git checkout "$base_branch"
  git checkout -b "sj/$branch"

  echo "Created clone at $clone_path on branch sj/$branch (based on $base_branch)"
}

# Remove a cloned repo directory. Warns if there are uncommitted changes.
# Run from within the clone you want to delete.
function gd() {
  local cwd="$(pwd)"
  local clone_name="$(basename "$cwd")"

  # Check for uncommitted changes
  if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
    echo "⚠️  Warning: You have uncommitted changes:"
    git status --short
    echo ""
    if ! gum confirm "Delete anyway?"; then
      echo "Aborted"
      return 1
    fi
  fi

  # Check for unpushed commits
  local unpushed="$(git log --oneline @{upstream}..HEAD 2>/dev/null)"
  if [[ -n "$unpushed" ]]; then
    echo "⚠️  Warning: You have unpushed commits:"
    echo "$unpushed"
    echo ""
    if ! gum confirm "Delete anyway?"; then
      echo "Aborted"
      return 1
    fi
  fi

  if gum confirm "Remove clone '$clone_name'?"; then
    cd ..
    rm -rf "$clone_name"
    echo "Removed $clone_name"
  fi
}

function zig-ast-check-all() {
  find . -name '.zig-cache' -prune -o -type f -name "*.zig" -exec zig ast-check {} \;
}

[[ $ZPROF == 1 ]] && zprof
