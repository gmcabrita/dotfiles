---
name: napkin-math
description: Estimate software system latency, throughput, capacity, and cloud costs from first principles using Sirupsen's napkin-math numbers. Use for back-of-the-envelope performance, storage, network, logging, compression, and cost calculations.
---

# Napkin Math

Use this skill to answer quick systems sizing questions: latency budgets, throughput ceilings, storage growth, logging cost, network transfer time, compression tradeoffs, and rough cloud spend.

## Source freshness

Treat the bundled numbers as a fallback, not truth forever. The upstream source is `https://github.com/sirupsen/napkin-math` and can change as hardware/cloud measurements change.

Before doing a calculation that depends on reference numbers:

1. Run `python3 scripts/napkin_math.py --query '<term>'` from this skill directory when looking for specific rows.
2. Run `python3 scripts/napkin_math.py --section all` when needing the full compact reference.
3. Prefer the script output over memory. It refreshes a local cache when stale.
4. If refresh fails, continue using stale cached data. If no cache exists, the script falls back to `references/current-numbers.md`.
5. Mention when using stale or bundled fallback numbers.

Cache behavior:

- Cache path: `~/.cache/napkin-math/README.md` by default.
- TTL: `86400` seconds by default.
- Override with `NAPKIN_MATH_CACHE_DIR` and `NAPKIN_MATH_TTL_SECONDS`.
- Force refresh with `--refresh`; skip network with `--offline`.

## Calculation workflow

Never rely on mental arithmetic for final numbers. Use code for every multiplication, division, exponent, unit conversion, and range endpoint.

1. State the goal in one line.
2. Decompose into at most 6 assumptions.
3. Fetch needed reference rows with `scripts/napkin_math.py`.
4. Compute with `scripts/calc.py` or an explicit Python snippet; include the command or formula in the answer.
5. Keep units on every step.
6. Use powers of ten and rounded coefficients; avoid faux precision.
7. Calculate a lower/likely/upper range when uncertainty dominates; compute each endpoint with code.
8. Call out bottleneck resource: CPU, memory bandwidth, disk, network, ops, or dollars.
9. End with the decision implication.

## Common commands

```bash
python3 scripts/napkin_math.py --query memory
python3 scripts/napkin_math.py --query 'blob storage'
python3 scripts/napkin_math.py --section cost
python3 scripts/napkin_math.py --section compression --offline
python3 scripts/napkin_math.py --refresh --section all
python3 scripts/calc.py '100_000/s * 1*KiB * 30*day' --to TiB
python3 scripts/calc.py '80*ms + 1*GiB / (100*MiB/s)' --to s
```

## Reference files

- `references/current-numbers.md`: bundled compact snapshot and fallback.
- `scripts/napkin_math.py`: cache refresh, fallback, section extraction, query filtering.
- `scripts/calc.py`: safe arithmetic and unit conversion helper.
- `scripts/test_napkin_math.py`: reference script unit tests.
- `scripts/test_calc.py`: calculator unit tests.
