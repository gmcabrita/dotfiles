import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, test } from "node:test"

import {
  AUTORESEARCH_CHECKS,
  AUTORESEARCH_IDEAS,
  AUTORESEARCH_LOG,
  AUTORESEARCH_MD,
  AUTORESEARCH_SCRIPT,
  buildStatusSummary,
  checksPath,
  logPath,
  mdPath,
  parseExperimentLog,
  parseMetricLines,
  scaffoldAutoresearchFiles,
  scriptPath,
  withWallClockMetric,
} from "./autoresearch.ts"

describe("paths", () => {
  test("stores state under autoresearch directory", () => {
    assert.equal(AUTORESEARCH_LOG, "autoresearch/autoresearch.jsonl")
    assert.equal(logPath("/tmp/project"), "/tmp/project/autoresearch/autoresearch.jsonl")
  })
})

describe("scaffoldAutoresearchFiles", () => {
  test("writes canonical files under autoresearch", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "autoresearch-"))

    try {
      const result = scaffoldAutoresearchFiles(directory, {
        objective: "speed up tests",
        benchmarkCommand: "pnpm test:fast",
        metricName: "wall_clock_s",
        metricUnit: "s",
        direction: "lower",
        secondaryMetrics: ["rss_mb"],
        filesInScope: ["src/", "tests/"],
        constraints: ["tests must still pass"],
        checksCommand: "pnpm test",
        overwrite: false,
      })

      assert.deepStrictEqual(result.created.sort(), [AUTORESEARCH_CHECKS, AUTORESEARCH_IDEAS, AUTORESEARCH_MD, AUTORESEARCH_SCRIPT])
      assert.deepStrictEqual(result.updated, [])
      assert.deepStrictEqual(result.skipped, [])
      assert.match(readFileSync(mdPath(directory), "utf8"), /bash autoresearch\/autoresearch\.sh/)
      assert.match(readFileSync(scriptPath(directory), "utf8"), /pnpm test:fast/)
      assert.match(readFileSync(checksPath(directory), "utf8"), /pnpm test/)
      assert.equal(Boolean(statSync(scriptPath(directory)).mode & 0o111), true)
      assert.equal(Boolean(statSync(checksPath(directory)).mode & 0o111), true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("skips differing files when overwrite is false", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "autoresearch-"))

    try {
      scaffoldAutoresearchFiles(directory, {
        objective: "first",
        benchmarkCommand: "echo first",
        metricName: "wall_clock_s",
        metricUnit: "s",
        direction: "lower",
        secondaryMetrics: [],
        filesInScope: [],
        constraints: [],
        checksCommand: null,
        overwrite: false,
      })

      const result = scaffoldAutoresearchFiles(directory, {
        objective: "second",
        benchmarkCommand: "echo second",
        metricName: "wall_clock_s",
        metricUnit: "s",
        direction: "lower",
        secondaryMetrics: [],
        filesInScope: [],
        constraints: [],
        checksCommand: null,
        overwrite: false,
      })

      assert.deepStrictEqual(result.created, [])
      assert.deepStrictEqual(result.updated, [])
      assert.deepStrictEqual(result.skipped.sort(), [AUTORESEARCH_IDEAS, AUTORESEARCH_MD, AUTORESEARCH_SCRIPT])
      assert.match(readFileSync(mdPath(directory), "utf8"), /first/)
      assert.doesNotMatch(readFileSync(mdPath(directory), "utf8"), /second/)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe("parseMetricLines", () => {
  test("parses metric output", () => {
    assert.deepStrictEqual(
      parseMetricLines([
        "hello",
        "METRIC wall_clock_s=1.23",
        "METRIC score = 42",
        "METRIC loss=1.2e-3",
      ].join("\n")),
      {
      wall_clock_s: 1.23,
      score: 42,
      loss: 0.0012,
      },
    )
  })

  test("adds wall clock metric when missing", () => {
    assert.deepStrictEqual(withWallClockMetric({ score: 7 }, 3.456789), {
      score: 7,
      wall_clock_s: 3.456789,
    })
  })
})

describe("parseExperimentLog", () => {
  test("keeps only latest config segment for current state", () => {
    const state = parseExperimentLog([
      JSON.stringify({ type: "config", name: "first", metricName: "wall_clock_s", metricUnit: "s", direction: "lower" }),
      JSON.stringify({ run: 1, commit: "aaaaaaa", metric: 10, metrics: { wall_clock_s: 10 }, status: "keep", description: "baseline", timestamp: 1 }),
      JSON.stringify({ type: "config", name: "second", metricName: "score", metricUnit: "", direction: "higher" }),
      JSON.stringify({ run: 2, commit: "bbbbbbb", metric: 7, metrics: { score: 7, wall_clock_s: 3 }, status: "keep", description: "baseline", timestamp: 2 }),
      JSON.stringify({ run: 3, commit: "ccccccc", metric: 8, metrics: { score: 8, wall_clock_s: 4 }, status: "discard", description: "worse tradeoff", timestamp: 3 }),
    ].join("\n"))

    assert.equal(state.config?.name, "second")
    assert.equal(state.currentResults.length, 2)
    assert.equal(state.baselineMetric, 7)
    assert.equal(state.bestMetric, 7)
    assert.deepStrictEqual(state.knownSecondaryMetrics, ["wall_clock_s"])
  })

  test("builds readable status summary", () => {
    const state = parseExperimentLog([
      JSON.stringify({ type: "config", name: "speed", metricName: "wall_clock_s", metricUnit: "s", direction: "lower" }),
      JSON.stringify({ run: 1, commit: "aaaaaaa", metric: 10, metrics: { wall_clock_s: 10 }, status: "keep", description: "baseline", timestamp: 1 }),
      JSON.stringify({ run: 2, commit: "bbbbbbb", metric: 8, metrics: { wall_clock_s: 8 }, status: "keep", description: "cache hit", timestamp: 2 }),
    ].join("\n"))

    const summary = buildStatusSummary(state, 5)
    assert.match(summary, /Best keep: 8s/)
    assert.match(summary, /#2 keep bbbbbbb 8s cache hit/)
  })
})
