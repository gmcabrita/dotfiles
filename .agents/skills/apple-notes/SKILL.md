---
name: apple-notes
description: Search local Apple Notes efficiently. Use when asked to find notes, search note text, inspect note snippets, or extract links/URLs stored in Apple Notes.
---

# Apple Notes

## Overview

Search local Apple Notes via the Notes SQLite store instead of manual `strings`/SQL probing. Use the bundled script to decompress note bodies, search terms, print matched context, and optionally extract URLs near matches.

## Quick Start

Run from any directory:

```bash
python3 ./scripts/search_notes.py fingerprint bypass --all-terms
```

Common tasks:

```bash
# Search notes and show context
python3 ./scripts/search_notes.py fingerprint bypass

# Require every term in the same note
python3 ./scripts/search_notes.py fingerprint bypass --all-terms

# GitHub links near matching terms
python3 ./scripts/search_notes.py fingerprint bypass --github-only --all-terms

# Show all URLs near matching terms
python3 ./scripts/search_notes.py "TLS fingerprinting" --show-urls

# Require at least one URL, any domain
python3 ./scripts/search_notes.py "TLS fingerprinting" --require-urls

# Wider context for long scratchpad notes
python3 ./scripts/search_notes.py botguard recaptcha --context 1200
```

## Workflow

1. Prefer `scripts/search_notes.py` for all Apple Notes text/link searches.
2. Start with concise terms from the user request.
3. Add `--all-terms` when the request implies combined concepts, e.g. “fingerprint bypass packages”.
4. Add `--show-urls` when URLs are requested but any domain is acceptable.
5. Add `--github-only` only when GitHub/Gist links are specifically requested.
6. Add `--require-urls` when matching notes must contain at least one URL.
7. Increase `--context` if relevant surrounding text is omitted or the note is a long scratchpad.
8. Return only relevant notes/snippets/links and mention the note title when useful.

## Notes Store Details

Default database:

`~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite`

The script reads `ZICCLOUDSYNCINGOBJECT` joined to `ZICNOTEDATA`, gzip-decompresses `ZDATA` when needed, decodes UTF-8 leniently, prints context windows around term matches, and extracts `http(s)` URLs when present.

## Validation

After editing the script, run:

```bash
python3 ./scripts/test_search_notes.py
```
