#!/usr/bin/env python3
from __future__ import annotations

import gzip
import sqlite3
import tempfile
import unittest
from pathlib import Path

import search_notes


class SearchNotesTests(unittest.TestCase):
    def make_db(self, data: bytes) -> Path:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        path = Path(temp.name) / "NoteStore.sqlite"
        con = sqlite3.connect(path)
        con.execute("create table ZICCLOUDSYNCINGOBJECT (Z_PK integer primary key, ZTITLE text, ZSNIPPET text)")
        con.execute("create table ZICNOTEDATA (ZNOTE integer, ZDATA blob)")
        con.execute("insert into ZICCLOUDSYNCINGOBJECT values (1, 'bot note', 'fingerprint snippet')")
        con.execute("insert into ZICNOTEDATA values (1, ?)", (data,))
        con.commit()
        con.close()
        return path

    def test_decodes_gzip_note_data(self) -> None:
        data = gzip.compress(b"Bypass TLS fingerprinting blocks: https://github.com/example/pkg")
        self.assertIn("Bypass TLS", search_notes.decode_note_data(data))

    def test_finds_github_url_near_terms(self) -> None:
        db = self.make_db(gzip.compress(b"Bypass TLS fingerprinting blocks: https://github.com/example/pkg"))
        matches = search_notes.find_matches(search_notes.load_notes(db), ["fingerprinting"], 100, True, False, True, True)
        self.assertEqual(matches[0].urls, ("https://github.com/example/pkg",))

    def test_all_terms_filters_notes(self) -> None:
        db = self.make_db(gzip.compress(b"fingerprinting only https://github.com/example/pkg"))
        matches = search_notes.find_matches(search_notes.load_notes(db), ["fingerprinting", "bypass"], 100, True, True, True, True)
        self.assertEqual(matches, [])

    def test_finds_note_without_url(self) -> None:
        db = self.make_db(gzip.compress(b"remember this plain text without links"))
        matches = search_notes.find_matches(search_notes.load_notes(db), ["plain text"], 100, False, False, False, False)
        self.assertEqual(matches[0].urls, ())
        self.assertIn("plain text", matches[0].contexts[0])

    def test_hides_urls_by_default(self) -> None:
        db = self.make_db(gzip.compress(b"fingerprinting https://github.com/example/pkg"))
        matches = search_notes.find_matches(search_notes.load_notes(db), ["fingerprinting"], 100, False, False, False, False)
        self.assertEqual(matches[0].urls, ())


if __name__ == "__main__":
    unittest.main()
