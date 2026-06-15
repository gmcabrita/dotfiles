#!/usr/bin/env python3
"""Safe unit-aware-ish calculator for napkin math expressions."""

from __future__ import annotations

import argparse
import ast
import math
import operator
from collections.abc import Callable

NUMBER = int | float
UNARY_OPS: dict[type[ast.unaryop], Callable[[NUMBER], NUMBER]] = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}
BINARY_OPS: dict[type[ast.operator], Callable[[NUMBER, NUMBER], NUMBER]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
CONSTANTS: dict[str, float] = {
    "K": 1e3,
    "M": 1e6,
    "B": 1e9,
    "T": 1e12,
    "P": 1e15,
    "KB": 1e3,
    "MB": 1e6,
    "GB": 1e9,
    "TB": 1e12,
    "PB": 1e15,
    "KiB": 2**10,
    "MiB": 2**20,
    "GiB": 2**30,
    "TiB": 2**40,
    "PiB": 2**50,
    "ns": 1e-9,
    "us": 1e-6,
    "μs": 1e-6,
    "ms": 1e-3,
    "s": 1.0,
    "sec": 1.0,
    "minute": 60.0,
    "hour": 3600.0,
    "day": 86_400.0,
    "month": 30 * 86_400.0,
    "year": 365 * 86_400.0,
    "USD": 1.0,
    "dollar": 1.0,
}
FUNCTIONS: dict[str, Callable[..., float]] = {
    "ceil": math.ceil,
    "floor": math.floor,
    "log10": math.log10,
    "max": max,
    "min": min,
    "round": round,
}
COMMON_UNITS = ["ns", "us", "ms", "s", "KiB", "MiB", "GiB", "TiB", "KB", "MB", "GB", "TB"]


def evaluate(expression: str) -> float:
    tree = ast.parse(expression, mode="eval")
    return float(eval_node(tree.body))


def eval_node(node: ast.AST) -> NUMBER:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.Name) and node.id in CONSTANTS:
        return CONSTANTS[node.id]
    if isinstance(node, ast.UnaryOp) and type(node.op) in UNARY_OPS:
        return UNARY_OPS[type(node.op)](eval_node(node.operand))
    if isinstance(node, ast.BinOp) and type(node.op) in BINARY_OPS:
        return BINARY_OPS[type(node.op)](eval_node(node.left), eval_node(node.right))
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FUNCTIONS:
        args = [float(eval_node(arg)) for arg in node.args]
        return FUNCTIONS[node.func.id](*args)
    raise ValueError(f"unsupported expression: {ast.dump(node)}")


def format_number(value: float) -> str:
    if value == 0:
        return "0"
    magnitude = abs(value)
    if 1e-3 <= magnitude < 1e6:
        return f"{value:,.6g}"
    return f"{value:.6g}"


def render(value: float, units: list[str]) -> str:
    lines = [f"raw = {format_number(value)}"]
    for unit in units:
        divisor = CONSTANTS[unit]
        lines.append(f"{unit} = {format_number(value / divisor)}")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("expression", help="Python-like expression. Example: '100_000/s * 1*KiB * 30*day'")
    parser.add_argument("--to", action="append", choices=sorted(CONSTANTS), help="Output converted value")
    parser.add_argument("--common", action="store_true", help="Also output common time/byte conversions")
    args = parser.parse_args()
    units = args.to or []
    if args.common:
        units = units + [unit for unit in COMMON_UNITS if unit not in units]
    print(render(evaluate(args.expression), units))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
