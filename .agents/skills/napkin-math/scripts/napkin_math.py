#!/usr/bin/env python3
"""Fetch, cache, and print Sirupsen napkin-math reference numbers."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from urllib.error import URLError

RAW_URL = "https://raw.githubusercontent.com/sirupsen/napkin-math/master/README.md"
DEFAULT_TTL_SECONDS = 86_400
SKILL_DIR = Path(__file__).resolve().parents[1]
FALLBACK_FILE = SKILL_DIR / "references" / "current-numbers.md"
SECTION_NAMES = {
    "all": "all",
    "performance": "Numbers",
    "numbers": "Numbers",
    "cost": "Cost Numbers",
    "compression": "Compression Ratios",
    "techniques": "Techniques",
}


@dataclass(frozen=True)
class Document:
    text: str
    source: str
    stale: bool


def cache_dir() -> Path:
    configured = os.environ.get("NAPKIN_MATH_CACHE_DIR")
    return Path(configured).expanduser() if configured else Path.home() / ".cache" / "napkin-math"


def ttl_seconds() -> int:
    configured = os.environ.get("NAPKIN_MATH_TTL_SECONDS")
    return max(0, int(configured)) if configured else DEFAULT_TTL_SECONDS


def cache_file() -> Path:
    return cache_dir() / "README.md"


def is_fresh(path: Path, ttl: int, now: float) -> bool:
    return path.exists() and ttl != 0 and now - path.stat().st_mtime <= ttl


def fetch_readme(timeout_seconds: float = 10.0) -> str:
    request = urllib.request.Request(RAW_URL, headers={"User-Agent": "pi-napkin-math-skill"})
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        return response.read().decode("utf-8")


def write_cache(text: str, now: float) -> None:
    cache_dir().mkdir(parents=True, exist_ok=True)
    cache_file().write_text(text, encoding="utf-8")
    (cache_dir() / "meta.json").write_text(
        json.dumps({"source": RAW_URL, "fetched_at": int(now)}, indent=2) + "\n",
        encoding="utf-8",
    )


def load_document(refresh: bool, offline: bool, fetcher=fetch_readme, now: float | None = None) -> Document:
    current_time = time.time() if now is None else now
    cached = cache_file()
    if not refresh and not offline and is_fresh(cached, ttl_seconds(), current_time):
        return Document(cached.read_text(encoding="utf-8"), f"fresh cache: {cached}", False)
    if offline and cached.exists():
        return Document(cached.read_text(encoding="utf-8"), f"offline cache: {cached}", False)
    if not offline:
        try:
            text = fetcher()
            write_cache(text, current_time)
            return Document(text, f"refreshed: {RAW_URL}", False)
        except (OSError, URLError, TimeoutError) as error:
            if cached.exists():
                return Document(cached.read_text(encoding="utf-8"), f"stale cache after refresh failure: {error}", True)
    return Document(FALLBACK_FILE.read_text(encoding="utf-8"), f"bundled fallback: {FALLBACK_FILE}", True)


def heading_bounds(lines: list[str], heading: str) -> tuple[int, int]:
    start = next((index for index, line in enumerate(lines) if line == f"## {heading}"), -1)
    if start < 0:
        return (-1, -1)
    end = next((index for index in range(start + 1, len(lines)) if lines[index].startswith("## ")), len(lines))
    return (start, end)


def compact_markdown(text: str) -> str:
    lines = text.splitlines()
    output: list[str] = []
    for heading in ["Numbers", "Cost Numbers", "Compression Ratios", "Techniques"]:
        start, end = heading_bounds(lines, heading)
        if start < 0:
            continue
        section = trim_numbers(lines[start:end]) if heading == "Numbers" else lines[start:end]
        output.extend(section + [""])
    return "\n".join(squash_blank_lines(output)).strip() + "\n"


def trim_numbers(lines: list[str]) -> list[str]:
    trimmed: list[str] = []
    for line in lines:
        if line.startswith("For the active Criterion suite"):
            break
        if not (line.startswith("[") and "]:" in line):
            trimmed.append(line)
    return trimmed


def squash_blank_lines(lines: list[str]) -> list[str]:
    squashed: list[str] = []
    previous_blank = False
    for line in lines:
        blank = line.strip() == ""
        if not (blank and previous_blank):
            squashed.append(line)
        previous_blank = blank
    return squashed


def select_section(markdown: str, section: str) -> str:
    heading = SECTION_NAMES[section]
    if heading == "all":
        return markdown
    lines = markdown.splitlines()
    start, end = heading_bounds(lines, heading)
    return "" if start < 0 else "\n".join(lines[start:end]).strip() + "\n"


def filter_query(markdown: str, query: str) -> str:
    needle = query.casefold()
    output: list[str] = []
    table_header: list[str] = []
    heading = ""
    emitted_heading = False
    emitted_table_header = False

    def emit_heading() -> None:
        nonlocal emitted_heading
        if heading and not emitted_heading:
            output.append(heading)
            emitted_heading = True

    for line in markdown.splitlines():
        if line.startswith("## "):
            heading = line
            emitted_heading = False
            emitted_table_header = False
            table_header = []
        elif line.startswith("| "):
            if "---" in line:
                table_header = table_header[-1:] + [line]
            elif len(table_header) < 2:
                table_header = [line]
            elif needle in line.casefold():
                emit_heading()
                if not emitted_table_header:
                    output.extend(table_header)
                    emitted_table_header = True
                output.append(line)
        elif needle in line.casefold():
            emit_heading()
            output.append(line)
    return "\n".join(squash_blank_lines(output)).strip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--section", choices=sorted(SECTION_NAMES), default="all")
    parser.add_argument("--query", help="Case-insensitive filter over compact reference rows")
    parser.add_argument("--refresh", action="store_true", help="Force refresh before reading")
    parser.add_argument("--offline", action="store_true", help="Use cache/fallback without network")
    args = parser.parse_args()
    document = load_document(refresh=args.refresh, offline=args.offline)
    markdown = select_section(compact_markdown(document.text), args.section)
    if args.query:
        markdown = filter_query(markdown, args.query)
    warning = " stale/fallback" if document.stale else ""
    sys.stdout.write(f"Source ({document.source}){warning}\n\n")
    sys.stdout.write(markdown if markdown.strip() else "No matches.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
