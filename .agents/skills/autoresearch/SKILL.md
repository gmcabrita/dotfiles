---
name: autoresearch
description: Run or resume an autonomous benchmark loop for perf, size, quality, or any metric-driven optimization in OpenCode.
compatibility: opencode
license: MIT
---

# Autoresearch

Autonomous experiment loop: try ideas, measure, keep wins, discard misses, keep going.

## Tools

- `scaffold_autoresearch` - create canonical files under `autoresearch/`
- `init_experiment` - set session name, primary metric, unit, direction
- `run_experiment` - run benchmark command, parse `METRIC name=value`, cache result
- `log_experiment` - log cached run, auto-commit `keep`, append `autoresearch/autoresearch.jsonl`
- `autoresearch_status` - summarize current segment and cached run

`run_experiment` always adds `wall_clock_s` if the command does not emit it.

## Folder Layout

Always keep autoresearch artifacts under `autoresearch/`.

Create the directory first if missing.

- `autoresearch/autoresearch.md`
- `autoresearch/autoresearch.sh`
- `autoresearch/autoresearch.checks.sh`
- `autoresearch/autoresearch.ideas.md`
- `autoresearch/autoresearch.jsonl`
- `autoresearch/autoresearch.last-run.json`

Do not create root-level `autoresearch.*` files.

## Safety First

This loop discards losing changes. Only run it in a clean, disposable branch/worktree.

- First check `git status --short`.
- If dirty, do not start in place unless user explicitly wants that risk.
- Prefer a dedicated branch like `autoresearch/<goal>-<date>`.

## Setup

1. Infer or gather:
   - goal
   - benchmark command
   - primary metric name
   - direction (`lower` or `higher`)
   - files in scope
   - hard constraints
2. Read the relevant files before changing anything.
3. Call `scaffold_autoresearch` to create `autoresearch/autoresearch.md`, `autoresearch/autoresearch.sh`, and optional extras.
4. If constraints require correctness gates, include `checks_command` so the tool also creates `autoresearch/autoresearch.checks.sh`.
5. Call `init_experiment`.
6. Run the baseline with `run_experiment`.
7. Log it with `log_experiment`.
8. Start looping immediately.

Do not hand-write the initial scaffold when the tool can create it.

If `autoresearch/autoresearch.jsonl` and `autoresearch/autoresearch.md` already exist, resume instead of reinitializing unless the target changed.

## Required Files

### `autoresearch/autoresearch.md`

Keep it strong enough that a fresh agent can resume from it alone.

Include:

- objective
- primary + secondary metrics
- exact benchmark command
- files in scope
- off-limits files
- constraints
- what has been tried

Update it as the loop learns.

### `autoresearch/autoresearch.sh`

Use `set -euo pipefail`.

Rules:

- keep it fast
- fail fast on obvious setup issues
- emit `METRIC name=value` lines
- emit the primary metric name exactly as configured in `init_experiment`
- keep output lean; errors matter more than chatter

Example:

```bash
#!/usr/bin/env bash
set -euo pipefail

value=$(pnpm test --run --reporter=dot >/tmp/autoresearch.out 2>&1; python3 scripts/extract_metric.py /tmp/autoresearch.out)
printf 'METRIC wall_clock_s=%s\n' "$value"
```

### `autoresearch/autoresearch.checks.sh`

Optional backpressure checks.

Use when the user cares about tests, types, lint, correctness, or quality gates.

Rules:

- `set -euo pipefail`
- keep success output short
- fail loudly enough to debug
- do not print giant logs unless needed

If checks fail, `log_experiment` must use `checks_failed`.

## Loop Rules

- Never stop to ask "should I continue?"
- Read `autoresearch/autoresearch.md` at session start and after compaction
- Prefer structural ideas over random micro-tweaks
- Keep primary metric first; secondary metrics are guardrails
- If a run passes and improves materially, use `keep`
- If a run passes but loses, use `discard`
- If the benchmark crashes or times out, use `crash`
- If checks fail or time out after a passing benchmark, use `checks_failed`
- Do not invent metrics in `log_experiment`; it uses the cached `run_experiment` result
- `keep` auto-commits; do not manual-commit before `log_experiment`

## Resume Flow

When resuming:

1. call `autoresearch_status`
2. read `autoresearch/autoresearch.md`
3. skim recent `git log --oneline -10`
4. continue the loop

## Reverting Losers

`log_experiment` does not revert files for you.

After `discard`, `crash`, or `checks_failed`, restore the worktree back to `HEAD` before the next attempt. Only do this in the clean dedicated branch/worktree from the safety step. Remove any untracked loser files you created.

## Ideas Backlog

If you find promising but deferred ideas, append bullets to `autoresearch/autoresearch.ideas.md`.

On resume:

- prune stale ideas
- keep good ones
- delete the file when exhausted

## Monitoring

There is no live Pi-style widget here.

Use:

- `autoresearch_status`
- `autoresearch/autoresearch.jsonl`
- `autoresearch/autoresearch.md`

## When To Reinitialize

Call `init_experiment` again only when the target changed enough that the baseline should reset:

- new benchmark
- new primary metric
- new direction
- new optimization domain
