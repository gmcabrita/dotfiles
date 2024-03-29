PATH="$HOME/.bin:/opt/homebrew/opt/sqlite/bin:/opt/homebrew/opt/libpq/bin:/opt/homebrew/opt/gnu-tar/libexec/gnubin:$PATH"
# export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
export PGGSSENCMODE=disable
export EDITOR=zed
export FZF_DEFAULT_OPTS="--color=light"
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

#### History

export HISTFILE=$HOME/.zsh_history
export HISTSIZE=50000
export SAVEHIST=5000

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

autoload -Uz compinit && compinit
zmodload zsh/complist
zstyle ':completion:*' menu select
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}'

. /opt/homebrew/opt/asdf/libexec/asdf.sh
source /opt/homebrew/opt/git-extras/share/git-extras/git-extras-completion.zsh
source "$(brew --prefix)/share/google-cloud-sdk/path.zsh.inc"
source "$(brew --prefix)/share/google-cloud-sdk/completion.zsh.inc"

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

#### Functions

function tailscale() {
 /Applications/Tailscale.app/Contents/MacOS/Tailscale "$@"
}

function g() {
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
