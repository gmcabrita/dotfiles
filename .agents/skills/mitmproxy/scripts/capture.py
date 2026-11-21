"""mitmproxy addon: record in-scope HTTP flows and every TLS hostname seen.

Usage: mitmweb -s capture.py --set capture_dir=DIR
  DIR/flows.jsonl  decrypted HTTP flows whose host matches allow_hosts/ignore_hosts
  DIR/hosts.jsonl  one line per TCP TLS connection (SNI), in scope or passed through
"""

import codecs
import json
import re
import time
from pathlib import Path

from mitmproxy import connection, ctx, http
from mitmproxy.proxy.layers.tls import parse_client_hello

MAX_BODY_BYTES = 20_000_000


def load(loader) -> None:
    loader.add_option("capture_dir", str, ".", "Directory for flows.jsonl and hosts.jsonl.")


def in_scope(host: str, port: int) -> bool:
    """Mirror mitmproxy's allow_hosts/ignore_hosts decision for a single request.

    mitmproxy applies those options per connection, and in regular proxy mode it never
    applies them to plain-HTTP requests, so the addon has to re-check before recording.
    """
    target = f"{host}:{port}"
    matches = lambda patterns: any(re.search(p, target, re.IGNORECASE) for p in patterns)
    if ctx.options.allow_hosts:
        return matches(ctx.options.allow_hosts)
    return not matches(ctx.options.ignore_hosts)


def _append(name: str, record: dict) -> None:
    with (Path(ctx.options.capture_dir).expanduser() / name).open("a") as f:
        f.write(json.dumps(record) + "\n")


def _body(message: http.Message | None) -> dict | None:
    content = message.get_content(strict=False) if message else None
    if not content:
        return None
    truncated = len(content) > MAX_BODY_BYTES
    try:
        # Decode UTF-8 explicitly: many APIs label UTF-8 as application/octet-stream, where get_text() picks latin-1.
        text = codecs.getincrementaldecoder("utf-8")().decode(content[:MAX_BODY_BYTES], final=not truncated)
    except UnicodeDecodeError:
        text = None
    return {"bytes": len(content), "truncated": truncated, "text": text}


def _headers(message: http.Message | None) -> list[list[str]] | None:
    if message is None:
        return None
    # Pairs, not a dict: HTTP/2 splits cookies into repeated headers and a dict would keep only one.
    return [[k.decode("latin-1"), v.decode("latin-1")] for k, v in message.headers.fields]


def _record_flow(flow: http.HTTPFlow) -> None:
    if not in_scope(flow.request.pretty_host, flow.request.port):
        return
    _append("flows.jsonl", {
        "ts": flow.request.timestamp_start,
        "client": flow.client_conn.peername[0] if flow.client_conn.peername else None,
        "method": flow.request.method,
        "url": flow.request.pretty_url,
        "http_version": flow.request.http_version,
        "status": flow.response.status_code if flow.response else None,
        "error": flow.error.msg if flow.error else None,
        "request_headers": _headers(flow.request),
        "request_body": _body(flow.request),
        "response_headers": _headers(flow.response),
        "response_body": _body(flow.response),
    })


response = _record_flow
error = _record_flow

_logged_connections: set[str] = set()


def next_layer(nextlayer) -> None:
    client: connection.Client = nextlayer.context.client
    if client.id in _logged_connections or nextlayer.context.server.transport_protocol != "tcp":
        return
    # Not TLS yet (e.g. the CONNECT request in regular mode) or an incomplete ClientHello:
    # the hook runs again for the next layer or when more data arrives.
    try:
        hello = parse_client_hello(nextlayer.data_client())
    except ValueError:
        return
    if hello is None or not hello.sni:
        return
    _logged_connections.add(client.id)
    address = nextlayer.context.server.address
    port = address[1] if address else 443
    _append("hosts.jsonl", {
        "ts": time.time(),
        "client": client.peername[0] if client.peername else None,
        "host": hello.sni,
        "port": port,
        "in_scope": in_scope(hello.sni, port),
    })


def client_disconnected(client: connection.Client) -> None:
    _logged_connections.discard(client.id)
