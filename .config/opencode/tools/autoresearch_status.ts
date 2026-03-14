import { tool } from "@opencode-ai/plugin"

import { buildStatusSummary, loadExperimentState, readLastRun, tailLines } from "../lib/autoresearch.ts"

export default tool({
  description: "Summarize the current autoresearch segment and the last cached run.",
  args: {
    limit: tool.schema.number().int().positive().optional().describe("How many recent runs to show. Defaults to 6."),
  },
  async execute(args, context) {
    const directory = process.cwd()
    const state = loadExperimentState(directory)
    const lines = [buildStatusSummary(state, args.limit ?? 6)]

    const lastRun = readLastRun(directory)
    if (lastRun !== null) {
      lines.push("")
      lines.push("Cached last run:")
      lines.push(`Command: ${lastRun.command}`)
      lines.push(`Benchmark: ${lastRun.benchmarkPassed ? "passed" : "failed"} in ${lastRun.durationSeconds}s`)
      if (lastRun.checksRan) {
        if (lastRun.checksPassed === true) lines.push("Checks: passed")
        else if (lastRun.checksTimedOut) lines.push("Checks: timed out")
        else lines.push("Checks: failed")
      }

      const metrics = Object.entries(lastRun.metrics)
      if (metrics.length > 0) {
        lines.push(`Metrics: ${metrics.map(([metricName, value]) => `${metricName}=${value}`).join(", ")}`)
      }

      if (lastRun.benchmarkOutputTail.length > 0) {
        lines.push("Output tail:")
        lines.push(tailLines(lastRun.benchmarkOutputTail, 20))
      }
    }

    return lines.join("\n")
  },
})
