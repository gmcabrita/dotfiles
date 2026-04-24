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

PATH="$HOME/.local/bin:$HOME/go/bin:$HOMEBREW_PREFIX/opt/sqlite/bin:$HOMEBREW_PREFIX/opt/libpq/bin:$HOMEBREW_PREFIX/opt/gnu-tar/libexec/gnubin:$PATH"
export HOMEBREW_CLEANUP_MAX_AGE_DAYS=30
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
export PI_SKIP_VERSION_CHECK=1
export HK_MISE=1
export DISABLE_SPRING=1
export PORTLESS_HTTPS=1
export OPENCODE_EXPERIMENTAL_LSP_TOOL=1
export OPENCODE_EXPERIMENTAL_PLAN_MODE=1
export TIDEWAVE_OPENCODE_EXECUTABLE=$HOMEBREW_PREFIX/bin/opencode
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
export FZF_DEFAULT_OPTS="--color=dark --style=full"
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

autoload -Uz add-zsh-hook
setopt PROMPT_SUBST

typeset -g __prompt_git_pwd=""
typeset -g __prompt_git_dirty=1

function __prompt_find_git_dir() {
  local dir=$PWD dotgit line gitdir

  while true; do
    dotgit="$dir/.git"
    if [[ -d "$dotgit" ]]; then
      print -r -- "$dotgit"
      return 0
    fi
    if [[ -f "$dotgit" ]]; then
      line="$(<"$dotgit")"
      if [[ "$line" == gitdir:\ * ]]; then
        gitdir="${line#gitdir: }"
        if [[ "$gitdir" != /* ]]; then
          gitdir="$dir/$gitdir"
        fi
        print -r -- "$gitdir"
        return 0
      fi
    fi
    if [[ "$dir" == "/" ]]; then
      return 1
    fi
    dir="${dir:h}"
  done
}

function __prompt_mark_git_dirty() {
  __prompt_git_dirty=1
}

function __prompt_refresh_git() {
  local gitdir head branch

  if (( ! __prompt_git_dirty )) && [[ "$PWD" == "$__prompt_git_pwd" ]]; then
    return
  fi

  __prompt_git_pwd="$PWD"
  __prompt_git_dirty=0
  gitdir="$(__prompt_find_git_dir)" || {
    RPROMPT=""
    return
  }

  if [[ ! -r "$gitdir/HEAD" ]]; then
    RPROMPT=""
    return
  fi

  head="$(<"$gitdir/HEAD")"
  if [[ "$head" == ref:\ refs/heads/* ]]; then
    branch="${head#ref: refs/heads/}"
  elif [[ "$head" == ref:\ * ]]; then
    branch="${head#ref: }"
  else
    branch="${head[1,7]}"
  fi

  RPROMPT="%F{yellow}git:${branch//\%/%%}%f"
}

add-zsh-hook preexec __prompt_mark_git_dirty
add-zsh-hook chpwd __prompt_mark_git_dirty
add-zsh-hook precmd __prompt_refresh_git

PS1='%F{green}%~%f %# '
RPROMPT=""


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
alias code="zed"

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

function gt() {
  gtime -v "$@" 2>&1
}

function gtt() {
  (gtime -v "$@" > /dev/null) 2>&1
}

function t() {
  /usr/bin/time -l "$@" 2>&1
}

function tt() {
  (/usr/bin/time -l "$@" > /dev/null) 2>&1
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
  go install golang.org/x/tools/gopls@latest
  mix local.hex --force
  rm -rf "$HOME/Library/Application Support/Zed/extensions/work/elixir"/expert-*(N)

  EDITOR_APP_ID="dev.zed.Zed"
  for ext in \
    rb py js jsx ts tsx json yml yaml toml go rs java kt swift \
    c h cc cpp cxx m mm cs php css scss md sh bash zsh sql xml zig ex exs heex
  do
    duti -s "$EDITOR_APP_ID" ".$ext" all
  done

  for uti in \
    public.text \
    public.plain-text \
    public.source-code \
    public.script \
    public.shell-script \
    public.python-script \
    public.ruby-script \
    public.perl-script \
    public.php-script \
    public.json \
    public.xml \
    public.css \
    net.daringfireball.markdown
  do
    duti -s "$EDITOR_APP_ID" "$uti" all
  done
}

function timestamps() {
  ts '[%Y-%m-%d %H:%M:%.S]'
}

function pvl() {
  command pv -betlap -u shaded "$@"
}

function pvb() {
  command pv -ptebar -u shaded "$@"
}

function pvr() {
  command pv -btrpg --buffer-size 1024 -u shaded "$@"
}

function update-everything() {
  brew update
  brew bundle install --cleanup --file=~/.config/Brewfile
  brew upgrade
  update-programming-languages
  pi update
  rm -f ~/.cache/macos_sdk_path

  echo "Remember that these exist:"
  echo "\tdoggo            DNS Client"
  echo "\tgsa              Analyze the size of Go binaries"
  echo "\tmo               Deep clean and optimize your Mac"
  echo "\toha              HTTP load generator"
  echo "\tpv               Monitor progress of data through a pipeline"
  echo "\tpvb              Monitor progress of data through a pipeline (bytes)"
  echo "\tpvl              Monitor progress of data through a pipeline (lines)"
  echo "\tpvr              Monitor progress of data through a pipeline (rate)"
  echo "\tspacer           Utility for adding spacers when command output stops"
  echo "\tt                Time program (Clocks, RSS, Context Switches)"
  echo "\tgt               Time program (Clocks, RSS, Context Switches), uses gnutime"
  echo "\ttspin            Log file highlighter"
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

# function sxr8() { _tradegate_quote IE00B5BMR087 1; }
# function sxr8loop() { _tradegate_loop IE00B5BMR087; }
# function sppw() { _tradegate_quote IE00BFY0GT14 1; }
# function sppwloop() { _tradegate_loop IE00BFY0GT14; }
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

function zig-ast-check-all() {
  find . -name '.zig-cache' -prune -o -type f -name "*.zig" -exec zig ast-check {} \;
}

[[ $ZPROF == 1 ]] && zprof
