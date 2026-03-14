import { existsSync } from "node:fs"
import path from "node:path"

import { tool } from "@opencode-ai/plugin"

import {
  AUTORESEARCH_CHECKS,
  loadExperimentState,
  parseMetricLines,
  tailLines,
  withWallClockMetric,
  writeLastRun,
  runProcess,
} from "../lib/autoresearch.ts"

export default tool({
  description: "Run an autoresearch benchmark command, parse METRIC lines, and cache the result for log_experiment.",
  args: {
    command: tool.schema.string().describe("Shell command to benchmark."),
    timeout_seconds: tool.schema.number().positive().optional().describe("Benchmark timeout in seconds. Defaults to 600."),
    checks_timeout_seconds: tool.schema.number().positive().optional().describe("Optional checks timeout in seconds. Defaults to 300 when autoresearch/autoresearch.checks.sh exists."),
  },
  async execute(args, context) {
    const directory = process.cwd()
    const state = loadExperimentState(directory)
    if (state.config === null) {
      return "No autoresearch session configured. Call init_experiment first."
    }

    const timeoutMs = Math.round((args.timeout_seconds ?? 600) * 1000)
    const benchmark = await runProcess("bash", ["-lc", args.command], directory, timeoutMs)
    const benchmarkOutput = [benchmark.stdout, benchmark.stderr].filter((part) => part.trim().length > 0).join("\n")
    const actualDurationSeconds = benchmark.durationSeconds

    const benchmarkPassed = benchmark.exitCode === 0 && !benchmark.timedOut

    let checksRan = false
    let checksPassed: boolean | null = null
    let checksTimedOut = false
    let checksOutput = ""

    const checksPath = path.join(directory, AUTORESEARCH_CHECKS)
    if (benchmarkPassed && existsSync(checksPath)) {
      checksRan = true
      const checksTimeoutMs = Math.round((args.checks_timeout_seconds ?? 300) * 1000)
      const checks = await runProcess("bash", [checksPath], directory, checksTimeoutMs)
      checksTimedOut = checks.timedOut
      checksPassed = checks.exitCode === 0 && !checks.timedOut
      checksOutput = [checks.stdout, checks.stderr].filter((part) => part.trim().length > 0).join("\n")
    }

    const metrics = benchmarkPassed
      ? withWallClockMetric(parseMetricLines(benchmarkOutput), actualDurationSeconds)
      : {}

    writeLastRun(directory, {
      command: args.command,
      exitCode: benchmark.exitCode,
      durationSeconds: actualDurationSeconds,
      benchmarkPassed,
      benchmarkTimedOut: benchmark.timedOut,
      benchmarkOutputTail: tailLines(benchmarkOutput, 80),
      checksRan,
      checksPassed,
      checksTimedOut,
      checksOutputTail: tailLines(checksOutput, 80),
      metrics,
      timestamp: Date.now(),
    })

    const lines = []
    if (benchmark.timedOut) {
      lines.push(`Benchmark timeout after ${actualDurationSeconds}s.`)
    } else if (!benchmarkPassed) {
      lines.push(`Benchmark failed with exit code ${benchmark.exitCode ?? -1} after ${actualDurationSeconds}s.`)
    } else {
      lines.push(`Benchmark passed in ${actualDurationSeconds}s.`)
    }

    if (checksRan) {
      if (checksTimedOut) lines.push("Checks timed out. Log this as checks_failed.")
      else if (checksPassed) lines.push("Checks passed.")
      else lines.push("Checks failed. Log this as checks_failed.")
    }

    if (Object.keys(metrics).length === 0) {
      lines.push("Metrics: none parsed. Emit `METRIC name=value` lines, or use `wall_clock_s` as the primary metric.")
    } else {
      lines.push("Metrics:")
      for (const [metricName, value] of Object.entries(metrics)) {
        lines.push(`- ${metricName}=${value}`)
      }
      if (metrics[state.config.metricName] === undefined) {
        lines.push(`Primary metric '${state.config.metricName}' missing from this run.`)
      }
    }

    const benchmarkTail = tailLines(benchmarkOutput, 80)
    if (benchmarkTail.length > 0) {
      lines.push("Benchmark output tail:")
      lines.push(benchmarkTail)
    }

    if (checksRan && checksOutput.trim().length > 0 && checksPassed !== true) {
      lines.push("Checks output tail:")
      lines.push(tailLines(checksOutput, 80))
    }

    return lines.join("\n")
  },
})
