#!/usr/bin/env bash
# Throwaway mitmweb session in its own directory, with its own CA, keys and password.
#
#   session.sh start DIR [mitmweb args...] --allow-hosts REGEX [--allow-hosts REGEX ...]
#   session.sh stop DIR
#
# start: creates DIR (mode 0700), DIR/conf as mitmproxy's confdir, a random web password in DIR/conf/config.yaml,
#        and runs mitmweb with capture.py writing DIR/flows.jsonl and DIR/hosts.jsonl. Web UI on 127.0.0.1:$MITMWEB_PORT (8898).
# stop:  stops the session's mitmweb and DIR/browser.pid, only after checking each process belongs to DIR,
#        and warns if the session CA is still trusted in the System keychain. Deleting DIR is left to the caller.
set -euo pipefail

skill_scripts=$(cd "$(dirname "$0")" && pwd)

die() { echo "session.sh: $*" >&2; exit 1; }

session_ca_sha256() {
  openssl x509 -in "$1/conf/mitmproxy-ca-cert.pem" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d :
}

start() {
  local dir=$1; shift
  [[ " $* " == *" --allow-hosts "* ]] ||
    die "pass at least one --allow-hosts; an empty allow list decrypts everything. Use --allow-hosts '(?!)' to decrypt nothing."
  [[ -e $dir ]] && die "$dir already exists; use a fresh directory per session."

  umask 077
  mkdir -p "$dir/conf"
  dir=$(cd "$dir" && pwd)
  local port=${MITMWEB_PORT:-8898} password
  password=$(openssl rand -hex 16)
  echo "web_password: $password" > "$dir/conf/config.yaml"
  echo "$port" > "$dir/web_port"

  mitmweb --set confdir="$dir/conf" \
    --web-host 127.0.0.1 --web-port "$port" --no-web-open-browser \
    -s "$skill_scripts/capture.py" --set capture_dir="$dir" \
    "$@" >"$dir/mitmweb.log" 2>&1 &
  echo $! > "$dir/mitmweb.pid"

  for _ in $(seq 50); do
    if curl -sf -o /dev/null -H "Authorization: Bearer $password" "http://127.0.0.1:$port/options"; then
      echo "Session:  $dir"
      echo "Web UI:   http://127.0.0.1:$port/?token=$password"
      echo "CA cert:  $dir/conf/mitmproxy-ca-cert.pem"
      return
    fi
    kill -0 "$(cat "$dir/mitmweb.pid")" 2>/dev/null || break
    sleep 0.2
  done
  cat "$dir/mitmweb.log" >&2
  stop "$dir" >/dev/null
  die "mitmweb did not come up."
}

stop() {
  local dir
  dir=$(cd "$1" && pwd)
  for pidfile in "$dir/mitmweb.pid" "$dir/browser.pid"; do
    [[ -f $pidfile ]] || continue
    local pid
    pid=$(cat "$pidfile")
    # Only signal processes started for this session: both mitmweb (confdir) and the browser (profile) have DIR in argv.
    if ps -p "$pid" -o command= 2>/dev/null | grep -qF "$dir"; then
      kill "$pid"
      for _ in $(seq 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
      kill -0 "$pid" 2>/dev/null && echo "WARNING: pid $pid ($pidfile) is still running." >&2
    fi
    rm -f "$pidfile"
  done

  if [[ -f $dir/conf/mitmproxy-ca-cert.pem ]] &&
     security find-certificate -a -Z /Library/Keychains/System.keychain 2>/dev/null | grep -q "$(session_ca_sha256 "$dir")"; then
    cat >&2 <<EOF
WARNING: this session's CA is still in the System keychain. Remove it BEFORE deleting $dir:
  sudo security remove-trusted-cert -d "$dir/conf/mitmproxy-ca-cert.pem"
  sudo security delete-certificate -Z $(session_ca_sha256 "$dir") /Library/Keychains/System.keychain
EOF
    return 1
  fi
  echo "Stopped. Delete $dir once any phone/Firefox/Java trust has been removed."
}

case ${1:-} in
  start) [[ $# -ge 2 ]] || die "usage: session.sh start DIR [mitmweb args...]"; start "${@:2}" ;;
  stop) [[ $# -eq 2 ]] || die "usage: session.sh stop DIR"; stop "$2" ;;
  *) die "usage: session.sh start DIR [mitmweb args...] | session.sh stop DIR" ;;
esac
