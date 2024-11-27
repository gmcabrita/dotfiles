PATH="/opt/homebrew/opt/rustup/bin:$HOME/.bin:/opt/homebrew/opt/sqlite/bin:/opt/homebrew/opt/libpq/bin:/opt/homebrew/opt/gnu-tar/libexec/gnubin:$PATH"
. "$HOME/.cargo/env"
# export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
export JEMALLOC_LIBS="-L$(brew --prefix jemalloc)/lib -ljemalloc"
export JEMALLOC_CFLAGS="-I$(brew --prefix jemalloc)/include"
export CPPFLAGS="-I$(brew --prefix jemalloc)/include -I$(xcrun --show-sdk-path)/usr/include -I$(brew --prefix sqlite)/include"
export LDFLAGS="-L$(brew --prefix jemalloc)/lib -L$(xcrun --show-sdk-path)/usr/lib -L$(brew --prefix sqlite)/lib"
export RUBY_CONFIGURE_OPTS=--with-jemalloc
export BUNDLE_IGNORE_FUNDING_REQUESTS=YES
export PGGSSENCMODE=disable
export EDITOR="zed"
export PSQL_EDITOR="zed -n -w"
export KUBE_EDITOR="zed -n -w"
export ERL_AFLAGS="-kernel shell_history enabled"
export FZF_DEFAULT_OPTS="--color=light"
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

#### History

export HISTFILE=$HOME/.zsh_history
export HISTSIZE=10000000
export SAVEHIST=10000000
export HISTORY_IGNORE="(ls|cd|pwd|exit|cd)*"

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

export MISE_SHELL=zsh
export __MISE_ORIG_PATH="$PATH"

mise() {
  local command
  command="${1:-}"
  if [ "$#" = 0 ]; then
    command /opt/homebrew/bin/mise
    return
  fi
  shift

  case "$command" in
  deactivate|shell|sh)
    # if argv doesn't contains -h,--help
    if [[ ! " $@ " =~ " --help " ]] && [[ ! " $@ " =~ " -h " ]]; then
      eval "$(command /opt/homebrew/bin/mise "$command" "$@")"
      return $?
    fi
    ;;
  esac
  command /opt/homebrew/bin/mise "$command" "$@"
}

_mise_hook() {
  eval "$(/opt/homebrew/bin/mise hook-env -s zsh)";
}
typeset -ag precmd_functions;
if [[ -z "${precmd_functions[(r)_mise_hook]+1}" ]]; then
  precmd_functions=( _mise_hook ${precmd_functions[@]} )
fi
typeset -ag chpwd_functions;
if [[ -z "${chpwd_functions[(r)_mise_hook]+1}" ]]; then
  chpwd_functions=( _mise_hook ${chpwd_functions[@]} )
fi

if [ -z "${_mise_cmd_not_found:-}" ]; then
    _mise_cmd_not_found=1
    [ -n "$(declare -f command_not_found_handler)" ] && eval "${$(declare -f command_not_found_handler)/command_not_found_handler/_command_not_found_handler}"

    function command_not_found_handler() {
        if /opt/homebrew/bin/mise hook-not-found -s zsh -- "$1"; then
          _mise_hook
          "$@"
        elif [ -n "$(declare -f _command_not_found_handler)" ]; then
            _command_not_found_handler "$@"
        else
            echo "zsh: command not found: $1" >&2
            return 127
        fi
    }
fi

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

autoload -Uz vcs_info
function precmd() { vcs_info; }
zstyle ':vcs_info:git:*' formats '(%b) '
setopt PROMPT_SUBST
PS1='%F{green}%~%f ${vcs_info_msg_0_}%# '

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
  git modified | xargs zed
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

function git-fetch-all-repos() {
  find . -type d -depth 1 -exec git --git-dir={}/.git --work-tree=$PWD/{} pull --all \;
  find . -type d -depth 1 -exec git --git-dir={}/.git --work-tree=$PWD/{} fetch origin master:master \;
  find . -type d -depth 1 -exec git --git-dir={}/.git --work-tree=$PWD/{} fetch origin main:main \;
}

function update-programming-languages() {
  mise plugins up
  mise up --bump
  mise reshim
  rustup update
  pip install "reladiff[all]"
}

function update-everything() {
  brew update && brew upgrade && update-programming-languages
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
