#!/usr/bin/env python3

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import napkin_math

README = """# Napkin Math

## Numbers

| Operation | Latency | Throughput |
| --------- | ------- | ---------- |
| Memory    | 1 ns    | 1 GiB/s    |
| Disk      | 1 ms    | 1 MiB/s    |

For the active Criterion suite, omit this long benchmark note.

## Cost Numbers

| What | Amount | $ / Month |
| ---- | ------ | --------- |
| CPU  | 1      | $15       |

## Compression Ratios

| What | Compression Ratio |
| ---- | ----------------- |
| HTML | 2-3x              |

## Techniques

- Keep the units.

## Resources

- omitted
"""


class NapkinMathTest(unittest.TestCase):
    def test_compact_markdown_removes_long_benchmark_note(self) -> None:
        compact = napkin_math.compact_markdown(README)
        self.assertIn("| Memory", compact)
        self.assertIn("## Cost Numbers", compact)
        self.assertNotIn("Criterion suite", compact)
        self.assertNotIn("## Resources", compact)

    def test_query_includes_matching_table_header(self) -> None:
        result = napkin_math.filter_query(napkin_math.compact_markdown(README), "memory")
        self.assertIn("| Operation", result)
        self.assertIn("| Memory", result)
        self.assertNotIn("| Disk", result)

    def test_fresh_cache_skips_fetch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory) / "README.md"
            cache.write_text(README, encoding="utf-8")
            with patch.dict(os.environ, {"NAPKIN_MATH_CACHE_DIR": directory}, clear=False):
                doc = napkin_math.load_document(False, False, fetcher=self.fail_fetch, now=cache.stat().st_mtime)
        self.assertFalse(doc.stale)
        self.assertIn("fresh cache", doc.source)
        self.assertEqual(README, doc.text)

    def test_refresh_failure_uses_stale_cache(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory) / "README.md"
            cache.write_text(README, encoding="utf-8")
            old_time = cache.stat().st_mtime + napkin_math.DEFAULT_TTL_SECONDS + 1
            with patch.dict(os.environ, {"NAPKIN_MATH_CACHE_DIR": directory}, clear=False):
                doc = napkin_math.load_document(False, False, fetcher=self.fail_fetch, now=old_time)
        self.assertTrue(doc.stale)
        self.assertIn("stale cache", doc.source)
        self.assertEqual(README, doc.text)

    def test_refresh_failure_without_cache_uses_bundled_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"NAPKIN_MATH_CACHE_DIR": directory}, clear=False):
                doc = napkin_math.load_document(False, False, fetcher=self.fail_fetch, now=0)
        self.assertTrue(doc.stale)
        self.assertIn("bundled fallback", doc.source)
        self.assertIn("Sequential Memory", doc.text)

    @staticmethod
    def fail_fetch() -> str:
        raise OSError("network down")


if __name__ == "__main__":
    unittest.main()
