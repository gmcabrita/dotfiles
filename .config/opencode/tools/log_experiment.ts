import { tool } from "@opencode-ai/plugin"

import {
  AUTORESEARCH_LAST_RUN,
  AUTORESEARCH_LOG,
  appendResultEntry,
  buildStatusSummary,
  clearLastRun,
  currentHead,
  formatMetric,
  loadExperimentState,
  readLastRun,
  runProcess,
  splitMetrics,
  type LoggedExperiment,
  type MetricMap,
} from "../lib/autoresearch.ts"

const runtimeExcludes = [`.`, `:(exclude)${AUTORESEARCH_LOG}`, `:(exclude)${AUTORESEARCH_LAST_RUN}`]

const buildCommitMessage = (description: string, status: string, primaryMetricName: string, primaryMetric: number, secondaryMetrics: MetricMap) => {
  const result: Record<string, string | number> = {
    status,
  }
  result[primaryMetricName] = primaryMetric

  for (const metricName of Object.keys(secondaryMetrics).sort()) {
    const metricValue = secondaryMetrics[metricName]
    if (metricValue === undefined) continue
    result[metricName] = metricValue
  }

  return `${description}\n\nResult: ${JSON.stringify(result)}`
}

const summarizeFailure = (label: string, result: Awaited<ReturnType<typeof runProcess>>) => {
  const output = [result.stdout, result.stderr].filter((part) => part.trim().length > 0).join("\n")
  const suffix = output.length > 0 ? `\n${output}` : ""
  return `${label} failed with exit code ${result.exitCode ?? -1}.${suffix}`
}

export default tool({
  description: "Log the cached autoresearch run, optionally commit keep results, and append to autoresearch/autoresearch.jsonl.",
  args: {
    status: tool.schema.enum(["keep", "discard", "crash", "checks_failed"]).describe("Outcome for the last cached run."),
    description: tool.schema.string().describe("Short description of the experiment."),
    allow_new_metrics: tool.schema.boolean().optional().describe("Allow new secondary metrics not seen earlier in the current segment."),
  },
  async execute(args, context) {
    const directory = process.cwd()
    const state = loadExperimentState(directory)
    if (state.config === null) {
      return "No autoresearch session configured. Call init_experiment first."
    }

    const lastRun = readLastRun(directory)
    if (lastRun === null) {
      return "No cached run found. Call run_experiment first."
    }

    if (!lastRun.benchmarkPassed && args.status !== "crash") {
      return "Last run failed or timed out. You must log it as crash."
    }

    if (lastRun.benchmarkPassed && lastRun.checksRan && lastRun.checksPassed !== true && args.status !== "checks_failed") {
      return "Last run checks failed or timed out. You must log it as checks_failed."
    }

    if (lastRun.benchmarkPassed && (!lastRun.checksRan || lastRun.checksPassed === true) && (args.status === "crash" || args.status === "checks_failed")) {
      return "Last run passed. Use keep or discard."
    }

    const metricsForLog = args.status === "crash" ? {} : lastRun.metrics
    const { primaryMetric, secondaryMetrics } = splitMetrics(metricsForLog, state.config.metricName)

    if (args.status !== "crash" && primaryMetric === undefined) {
      return `Primary metric '${state.config.metricName}' missing from the cached run. Fix the benchmark output and run again.`
    }

    const missingMetrics = state.knownSecondaryMetrics.filter((metricName) => secondaryMetrics[metricName] === undefined)
    if (missingMetrics.length > 0) {
      return `Missing secondary metrics: ${missingMetrics.join(", ")}. Emit them again before logging this run.`
    }

    const newSecondaryMetrics = Object.keys(secondaryMetrics).filter((metricName) => !state.knownSecondaryMetrics.includes(metricName))
    if (state.currentResults.length > 0 && newSecondaryMetrics.length > 0 && !args.allow_new_metrics) {
      return `New secondary metrics detected: ${newSecondaryMetrics.join(", ")}. Re-run log_experiment with allow_new_metrics: true if intentional.`
    }

    let commit = await currentHead(directory)
    let gitSummary = `Git: skipped commit for ${args.status}.`

    if (args.status === "keep") {
      const addResult = await runProcess("git", ["add", "-A", "--", ...runtimeExcludes], directory, 10000)
      if (addResult.exitCode !== 0) return summarizeFailure("git add", addResult)

      const diffResult = await runProcess("git", ["diff", "--cached", "--quiet", "--"], directory, 10000)
      if (diffResult.exitCode === 1) {
        const commitMessage = buildCommitMessage(args.description, args.status, state.config.metricName, primaryMetric ?? 0, secondaryMetrics)
        const commitResult = await runProcess("git", ["commit", "-m", commitMessage], directory, 20000)
        if (commitResult.exitCode !== 0) return summarizeFailure("git commit", commitResult)

        commit = await currentHead(directory)
        gitSummary = `Git: committed ${commit}.`
      } else if (diffResult.exitCode === 0) {
        gitSummary = "Git: nothing to commit."
      } else {
        return summarizeFailure("git diff --cached", diffResult)
      }
    }

    const logged: LoggedExperiment = {
      run: state.results.length + 1,
      commit,
      metric: args.status === "crash" ? 0 : primaryMetric ?? 0,
      metrics: metricsForLog,
      status: args.status,
      description: args.description,
      timestamp: Date.now(),
      segment: state.currentSegment,
    }

    appendResultEntry(directory, logged)
    clearLastRun(directory)

    const nextState = loadExperimentState(directory)
    const lines = [
      `Logged run #${logged.run}.`,
      `Status: ${args.status}`,
      `Primary: ${formatMetric(logged.metric, state.config.metricUnit)}`,
    ]

    if (Object.keys(secondaryMetrics).length > 0) {
      lines.push(`Secondary: ${Object.keys(secondaryMetrics).sort().map((metricName) => `${metricName}=${secondaryMetrics[metricName]}`).join(", ")}`)
    }

    lines.push(gitSummary)
    lines.push("")
    lines.push(buildStatusSummary(nextState, 6))
    return lines.join("\n")
  },
})
