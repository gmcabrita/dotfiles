#!/usr/bin/env python3

from __future__ import annotations

import unittest

import calc


class CalcTest(unittest.TestCase):
    def test_byte_time_expression(self) -> None:
        value = calc.evaluate("100_000/s * 1*KiB * 30*day")
        self.assertAlmostEqual(value / calc.CONSTANTS["TiB"], 241.399, places=3)

    def test_latency_plus_transfer(self) -> None:
        value = calc.evaluate("80*ms + 1*GiB / (100*MiB/s)")
        self.assertAlmostEqual(value, 10.32, places=2)

    def test_rejects_unsafe_expression(self) -> None:
        with self.assertRaises(ValueError):
            calc.evaluate("__import__('os').system('true')")

    def test_render_conversion(self) -> None:
        result = calc.render(calc.evaluate("1024*MiB"), ["GiB"])
        self.assertIn("GiB = 1", result)


if __name__ == "__main__":
    unittest.main()
