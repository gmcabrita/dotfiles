#!/usr/bin/env python3
"""Drive the mitmweb of a session created by session.sh, through its HTTP API.

  mitmweb_api.py [--session DIR] allow-hosts [PATTERN ...]   # replace allow_hosts live; no args = show
  mitmweb_api.py [--session DIR] log                          # mitmweb's event log (mitmweb.log stays empty while running)
  mitmweb_api.py [--session DIR] wireguard-conf               # print the WireGuard client config
  mitmweb_api.py [--session DIR] wireguard-qr OUT.png         # write it as a QR code

The password and web port are read from DIR/conf/config.yaml and DIR/web_port (default DIR: current directory).
Verified against mitmweb 12.3.1; earlier 12.x releases used a different XSRF cookie name.
"""

import argparse
import json
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

SEGNO = "segno==1.6.6"


def request(session: Path, method: str, path: str, payload=None):
    password = re.search(r"^web_password: (\S+)$", (session / "conf/config.yaml").read_text(), re.M).group(1)
    port = (session / "web_port").read_text().strip()
    # mitmweb accepts any _mitmproxy_xsrf cookie value as long as the X-XSRFToken header matches it.
    xsrf = secrets.token_hex(16)
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        method=method,
        data=None if payload is None else json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {password}",
            "X-XSRFToken": xsrf,
            "Cookie": f"_mitmproxy_xsrf={xsrf}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            body = r.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"mitmweb API: {method} {path} returned {e.code}")
    except urllib.error.URLError as e:
        sys.exit(f"mitmweb API: cannot reach 127.0.0.1:{port} ({e.reason})")
    return json.loads(body) if body else None


def validate_patterns(patterns: list[str]) -> None:
    # mitmweb accepts an invalid regex with 200, then every new connection through the proxy hangs.
    for pattern in patterns:
        try:
            re.compile(pattern, re.IGNORECASE)
        except re.error as e:
            sys.exit(f"Invalid regex {pattern!r}: {e}")


def wireguard_conf(session: Path) -> str:
    confs = [s["wireguard_conf"] for s in request(session, "GET", "/state")["servers"].values() if s.get("wireguard_conf")]
    if not confs:
        sys.exit("No running WireGuard server; start the session with --mode wireguard.")
    return confs[0]


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--session", type=Path, default=Path("."))
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("allow-hosts").add_argument("patterns", nargs="*")
    sub.add_parser("log")
    sub.add_parser("wireguard-conf")
    sub.add_parser("wireguard-qr").add_argument("out")
    args = p.parse_args()

    if args.cmd == "allow-hosts":
        if args.patterns:
            validate_patterns(args.patterns)
            request(args.session, "PUT", "/options", {"allow_hosts": args.patterns})
        print("\n".join(request(args.session, "GET", "/options")["allow_hosts"]["value"]) or "(empty: everything is decrypted)")
    elif args.cmd == "log":
        for event in request(args.session, "GET", "/events"):
            print(f"{event['level']:>5} {event['message']}")
    elif args.cmd == "wireguard-conf":
        print(wireguard_conf(args.session))
    elif args.cmd == "wireguard-qr":
        # The config holds the client private key: pass it on stdin, never in argv.
        qr = "import segno, sys; segno.make(sys.stdin.read()).save(sys.argv[1], scale=10, border=3)"
        result = subprocess.run(["uv", "run", "--quiet", "--with", SEGNO, "python", "-c", qr, args.out],
                                input=wireguard_conf(args.session), text=True, capture_output=True)
        if result.returncode:
            sys.exit(f"QR generation failed (exit {result.returncode}): {result.stderr.strip().splitlines()[-1:]}")
        print(args.out)


if __name__ == "__main__":
    main()
