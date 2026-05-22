#!/usr/bin/env python3
"""Search local Apple Notes SQLite data."""
from __future__ import annotations

import argparse
import gzip
import os
import re
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path

DEFAULT_DB = Path.home() / "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite"
URL_RE = re.compile(r"https?://[^\s<>\"\]\)]+", re.IGNORECASE)
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]+")


@dataclass(frozen=True)
class Note:
    pk: int
    title: str
    snippet: str
    text: str


@dataclass(frozen=True)
class Match:
    note: Note
    urls: tuple[str, ...]
    contexts: tuple[str, ...]


def decode_note_data(data: bytes) -> str:
    payload = data
    if data.startswith(b"\x1f\x8b"):
        try:
            payload = gzip.decompress(data)
        except OSError:
            payload = data
    text = payload.decode("utf-8", "ignore")
    return CONTROL_RE.sub(" ", text)


def note_label(note: Note) -> str:
    return note.title or note.snippet or f"note {note.pk}"


def normalize_url(url: str) -> str:
    return url.rstrip(".,;:!?)]}\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u000b\u000c")


def unique(values: list[str]) -> tuple[str, ...]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            out.append(value)
    return tuple(out)


def load_notes(db_path: Path) -> list[Note]:
    uri = f"file:{db_path}?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    rows = con.execute(
        """
        select n.Z_PK, coalesce(n.ZTITLE, ''), coalesce(n.ZSNIPPET, ''), d.ZDATA
        from ZICCLOUDSYNCINGOBJECT n
        join ZICNOTEDATA d on d.ZNOTE = n.Z_PK
        where d.ZDATA is not null
        """
    )
    notes = [Note(int(pk), str(title), str(snippet), decode_note_data(bytes(data))) for pk, title, snippet, data in rows]
    con.close()
    return notes


def find_matches(
    notes: list[Note],
    terms: list[str],
    context_chars: int,
    github_only: bool,
    all_terms: bool,
    require_urls: bool,
    show_urls: bool,
) -> list[Match]:
    term_res = [re.compile(re.escape(term), re.IGNORECASE) for term in terms]
    matches: list[Match] = []
    for note in notes:
        haystack = "\n".join([note.title, note.snippet, note.text])
        if term_res:
            term_hits = [list(term_re.finditer(haystack)) for term_re in term_res]
            if all_terms and not all(term_hits):
                continue
            spans = [hit.span() for hits in term_hits for hit in hits]
            if not spans:
                continue
        else:
            spans = [(0, len(haystack))]

        contexts: list[str] = []
        urls: list[str] = []
        for start, end in spans:
            left = max(0, start - context_chars)
            right = min(len(haystack), end + context_chars)
            context = haystack[left:right]
            contexts.append(re.sub(r"\s+", " ", context).strip())
            urls.extend(normalize_url(match.group(0)) for match in URL_RE.finditer(context))

        if not urls:
            urls = [normalize_url(match.group(0)) for match in URL_RE.finditer(haystack)]
        if github_only:
            urls = [url for url in urls if "github.com" in url.lower() or "gist.github.com" in url.lower()]
        if urls or not require_urls:
            matches.append(Match(note, unique(urls) if show_urls else (), unique(contexts)))
    return matches


def render_markdown(matches: list[Match]) -> str:
    if not matches:
        return "No matches."
    lines: list[str] = []
    for match in matches:
        lines.append(f"## {note_label(match.note)} (`{match.note.pk}`)")
        if match.urls:
            lines.append("URLs:")
            lines.extend(f"- {url}" for url in match.urls)
        if match.contexts:
            lines.append("")
            lines.append("Context:")
            for context in match.contexts[:3]:
                lines.append(f"> {context}")
        lines.append("")
    return "\n".join(lines).rstrip()


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Search Apple Notes and extract URLs near terms.")
    parser.add_argument("terms", nargs="*", help="Search terms. Default: list URLs from all notes.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help=f"Notes SQLite path. Default: {DEFAULT_DB}")
    parser.add_argument("--context", type=int, default=500, help="Characters around term matches to scan for URLs.")
    parser.add_argument("--github-only", action="store_true", help="Only print GitHub/Gist URLs.")
    parser.add_argument("--show-urls", action="store_true", help="Print URLs found near matches.")
    parser.add_argument("--all-terms", action="store_true", help="Require every term to occur in the note.")
    parser.add_argument("--require-urls", action="store_true", help="Only print notes with URLs in the matched context/note.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if not args.db.exists():
        print(f"Apple Notes database not found: {args.db}", file=sys.stderr)
        return 2
    matches = find_matches(
        load_notes(args.db),
        args.terms,
        args.context,
        args.github_only,
        args.all_terms,
        args.require_urls or args.github_only,
        args.show_urls or args.require_urls or args.github_only,
    )
    print(render_markdown(matches))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
