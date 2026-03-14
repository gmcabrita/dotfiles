import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"
import path from "node:path"

export const AUTORESEARCH_DIR = "autoresearch"
export const AUTORESEARCH_LOG = "autoresearch/autoresearch.jsonl"
export const AUTORESEARCH_LAST_RUN = "autoresearch/autoresearch.last-run.json"
export const AUTORESEARCH_MD = "autoresearch/autoresearch.md"
export const AUTORESEARCH_SCRIPT = "autoresearch/autoresearch.sh"
export const AUTORESEARCH_CHECKS = "autoresearch/autoresearch.checks.sh"
export const AUTORESEARCH_IDEAS = "autoresearch/autoresearch.ideas.md"

export type Direction = "lower" | "higher"
export type ExperimentStatus = "keep" | "discard" | "crash" | "checks_failed"
export type MetricMap = Record<string, number>

export interface ExperimentConfig {
  name: string
  metricName: string
  metricUnit: string
  direction: Direction
  segment: number
}

export interface LoggedExperiment {
  run: number
  commit: string
  metric: number
  metrics: MetricMap
  status: ExperimentStatus
  description: string
  timestamp: number
  segment: number
}

export interface ExperimentState {
  config: ExperimentConfig | null
  currentSegment: number
  results: LoggedExperiment[]
  currentResults: LoggedExperiment[]
  baselineMetric: number | null
  bestMetric: number | null
  knownSecondaryMetrics: string[]
}

export interface LastRunRecord {
  command: string
  exitCode: number | null
  durationSeconds: number
  benchmarkPassed: boolean
  benchmarkTimedOut: boolean
  benchmarkOutputTail: string
  checksRan: boolean
  checksPassed: boolean | null
  checksTimedOut: boolean
  checksOutputTail: string
  metrics: MetricMap
  timestamp: number
}

export interface ProcessResult {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  durationSeconds: number
}

export interface ScaffoldInput {
  objective: string
  benchmarkCommand: string
  metricName: string
  metricUnit: string
  direction: Direction
  secondaryMetrics: string[]
  filesInScope: string[]
  constraints: string[]
  checksCommand: string | null
  overwrite: boolean
}

export interface ScaffoldResult {
  created: string[]
  updated: string[]
  skipped: string[]
}

type FileWriteStatus = "created" | "updated" | "skipped"

interface PendingResult {
  run: number | null
  commit: string
  metric: number
  metrics: MetricMap
  status: ExperimentStatus
  description: string
  timestamp: number
}

interface PendingConfig {
  name: string
  metricName: string
  metricUnit: string
  direction: Direction
}

const emptyState = (): ExperimentState => ({
  config: null,
  currentSegment: 0,
  results: [],
  currentResults: [],
  baselineMetric: null,
  bestMetric: null,
  knownSecondaryMetrics: [],
})

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const readString = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key]
  return typeof value === "string" ? value : null
}

const readNumber = (record: Record<string, unknown>, key: string): number | null => {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

const readBoolean = (record: Record<string, unknown>, key: string): boolean | null => {
  const value = record[key]
  return typeof value === "boolean" ? value : null
}

const readDirection = (record: Record<string, unknown>, key: string): Direction | null => {
  const value = record[key]
  return value === "lower" || value === "higher" ? value : null
}

const readStatus = (record: Record<string, unknown>, key: string): ExperimentStatus | null => {
  const value = record[key]
  return value === "keep" || value === "discard" || value === "crash" || value === "checks_failed"
    ? value
    : null
}

const readMetricMap = (record: Record<string, unknown>, key: string): MetricMap => {
  const value = record[key]
  if (!isRecord(value)) return {}

  const metrics: MetricMap = {}
  for (const [metricName, metricValue] of Object.entries(value)) {
    if (typeof metricValue === "number" && Number.isFinite(metricValue)) {
      metrics[metricName] = metricValue
    }
  }
  return metrics
}

const parseConfig = (value: unknown): PendingConfig | null => {
  if (!isRecord(value)) return null
  if (readString(value, "type") !== "config") return null

  const name = readString(value, "name")
  const metricName = readString(value, "metricName")
  const metricUnit = readString(value, "metricUnit")
  const direction = readDirection(value, "direction") ?? readDirection(value, "bestDirection")

  if (name === null || metricName === null || metricUnit === null || direction === null) {
    return null
  }

  return {
    name,
    metricName,
    metricUnit,
    direction,
  }
}

const parseResult = (value: unknown): PendingResult | null => {
  if (!isRecord(value)) return null

  const commit = readString(value, "commit")
  const metric = readNumber(value, "metric")
  const status = readStatus(value, "status")
  const description = readString(value, "description")
  const timestamp = readNumber(value, "timestamp")

  if (commit === null || metric === null || status === null || description === null || timestamp === null) {
    return null
  }

  const run = readNumber(value, "run")
  return {
    run,
    commit,
    metric,
    metrics: readMetricMap(value, "metrics"),
    status,
    description,
    timestamp,
  }
}

const appendUnique = (items: string[], value: string) => {
  if (!items.includes(value)) items.push(value)
}

const formatCount = (count: number, noun: string) => {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

const normalizeEntries = (values: string[]): string[] => {
  return values.map((value) => value.trim()).filter((value) => value.length > 0)
}

const formatBulletList = (values: string[], emptyLabel: string) => {
  if (values.length === 0) return `- ${emptyLabel}`
  return values.map((value) => `- ${value}`).join("\n")
}

const writeManagedFile = (filePath: string, content: string, overwrite: boolean, executable: boolean): FileWriteStatus => {
  const alreadyExists = existsSync(filePath)

  if (alreadyExists) {
    const current = readFileSync(filePath, "utf8")
    if (current === content) {
      if (executable) chmodSync(filePath, 0o755)
      return "skipped"
    }

    if (!overwrite) {
      if (executable) chmodSync(filePath, 0o755)
      return "skipped"
    }
  }

  writeFileSync(filePath, content)
  if (executable) chmodSync(filePath, 0o755)
  return alreadyExists ? "updated" : "created"
}

export const ensureAutoresearchDir = (directory: string) => {
  mkdirSync(path.join(directory, AUTORESEARCH_DIR), { recursive: true })
}

export const mdPath = (directory: string) => {
  return path.join(directory, AUTORESEARCH_MD)
}

export const scriptPath = (directory: string) => {
  return path.join(directory, AUTORESEARCH_SCRIPT)
}

export const checksPath = (directory: string) => {
  return path.join(directory, AUTORESEARCH_CHECKS)
}

export const ideasPath = (directory: string) => {
  return path.join(directory, AUTORESEARCH_IDEAS)
}

export const logPath = (directory: string) => {
  return path.join(directory, AUTORESEARCH_LOG)
}

export const lastRunPath = (directory: string) => {
  return path.join(directory, AUTORESEARCH_LAST_RUN)
}

export const renderAutoresearchMarkdown = (input: Omit<ScaffoldInput, "overwrite">) => {
  const secondaryMetrics = normalizeEntries(input.secondaryMetrics)
  const filesInScope = normalizeEntries(input.filesInScope)
  const constraints = normalizeEntries(input.constraints)

  return [
    "# Objective",
    input.objective,
    "",
    "# Benchmark",
    `- Command: \`bash ${AUTORESEARCH_SCRIPT}\``,
    `- Primary metric: \`${input.metricName}\` (${input.metricUnit.length > 0 ? input.metricUnit : "unitless"}, ${input.direction} is better)`,
    `- State log: \`${AUTORESEARCH_LOG}\``,
    input.checksCommand === null ? "- Checks: none yet" : `- Checks: \`bash ${AUTORESEARCH_CHECKS}\``,
    "",
    "## Raw benchmark command",
    "```bash",
    input.benchmarkCommand,
    "```",
    ...(input.checksCommand === null
      ? []
      : ["", "## Raw checks command", "```bash", input.checksCommand, "```"]),
    "",
    "# Secondary Metrics",
    formatBulletList(secondaryMetrics, "none yet"),
    "",
    "# Files In Scope",
    formatBulletList(filesInScope, "decide after repo scan"),
    "",
    "# Constraints",
    formatBulletList(constraints, "none recorded"),
    "",
    "# What Has Been Tried",
    "- Baseline pending",
    "",
    "# Notes",
    "- Keep winning changes small and measurable",
    "- Log every run with `log_experiment`",
    "",
  ].join("\n")
}

export const renderAutoresearchScript = (command: string) => {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    command,
    "",
  ].join("\n")
}

export const renderIdeasMarkdown = () => {
  return [
    "# Ideas",
    "",
    "- none yet",
    "",
  ].join("\n")
}

export const scaffoldAutoresearchFiles = (directory: string, input: ScaffoldInput): ScaffoldResult => {
  ensureAutoresearchDir(directory)

  const result: ScaffoldResult = {
    created: [],
    updated: [],
    skipped: [],
  }

  const register = (relativePath: string, status: "created" | "updated" | "skipped") => {
    result[status].push(relativePath)
  }

  register(
    AUTORESEARCH_MD,
    writeManagedFile(mdPath(directory), renderAutoresearchMarkdown(input), input.overwrite, false),
  )
  register(
    AUTORESEARCH_SCRIPT,
    writeManagedFile(scriptPath(directory), renderAutoresearchScript(input.benchmarkCommand), input.overwrite, true),
  )
  register(
    AUTORESEARCH_IDEAS,
    writeManagedFile(ideasPath(directory), renderIdeasMarkdown(), input.overwrite, false),
  )

  if (input.checksCommand !== null) {
    register(
      AUTORESEARCH_CHECKS,
      writeManagedFile(checksPath(directory), renderAutoresearchScript(input.checksCommand), input.overwrite, true),
    )
  }

  return result
}

export const isBetter = (current: number, best: number, direction: Direction) => {
  return direction === "lower" ? current < best : current > best
}

export const parseMetricLines = (output: string): MetricMap => {
  const metrics: MetricMap = {}
  const pattern = /^\s*METRIC\s+([A-Za-z0-9._:-]+)\s*=\s*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*$/

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(pattern)
    if (!match) continue

    const metricName = match[1]
    const rawValue = match[2]
    if (metricName === undefined || rawValue === undefined) continue

    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) continue
    metrics[metricName] = parsed
  }

  return metrics
}

export const withWallClockMetric = (metrics: MetricMap, durationSeconds: number): MetricMap => {
  if (metrics.wall_clock_s !== undefined) return metrics
  return {
    ...metrics,
    wall_clock_s: Number(durationSeconds.toFixed(6)),
  }
}

export const tailLines = (input: string, limit: number): string => {
  const trimmed = input.trim()
  if (!trimmed) return ""
  return trimmed.split(/\r?\n/).slice(-limit).join("\n")
}

export const parseExperimentLog = (text: string): ExperimentState => {
  if (!text.trim()) return emptyState()

  const results: LoggedExperiment[] = []
  let config: ExperimentConfig | null = null
  let segment = -1

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }

    const nextConfig = parseConfig(parsed)
    if (nextConfig !== null) {
      segment += 1
      config = {
        ...nextConfig,
        segment,
      }
      continue
    }

    const nextResult = parseResult(parsed)
    if (nextResult === null) continue

    const currentSegment = segment >= 0 ? segment : 0
    results.push({
      ...nextResult,
      run: nextResult.run ?? results.length + 1,
      segment: currentSegment,
    })
  }

  const currentSegment = config !== null ? config.segment : segment >= 0 ? segment : 0
  const currentResults = results.filter((result) => result.segment === currentSegment)
  const baselineResult = currentResults[0]
  const baselineMetric = baselineResult !== undefined ? baselineResult.metric : null

  let bestMetric: number | null = null
  if (config !== null) {
    for (const result of currentResults) {
      if (result.status !== "keep") continue
      if (bestMetric === null || isBetter(result.metric, bestMetric, config.direction)) {
        bestMetric = result.metric
      }
    }
  }

  const knownSecondaryMetrics: string[] = []
  const primaryMetric = config?.metricName ?? null
  for (const result of currentResults) {
    for (const metricName of Object.keys(result.metrics)) {
      if (metricName === primaryMetric) continue
      appendUnique(knownSecondaryMetrics, metricName)
    }
  }

  return {
    config,
    currentSegment,
    results,
    currentResults,
    baselineMetric,
    bestMetric,
    knownSecondaryMetrics,
  }
}

export const loadExperimentState = (directory: string): ExperimentState => {
  const file = logPath(directory)
  if (!existsSync(file)) return emptyState()
  return parseExperimentLog(readFileSync(file, "utf8"))
}

export const writeConfigEntry = (directory: string, config: Omit<ExperimentConfig, "segment">) => {
  ensureAutoresearchDir(directory)
  const file = logPath(directory)
  const line = JSON.stringify({
    type: "config",
    name: config.name,
    metricName: config.metricName,
    metricUnit: config.metricUnit,
    direction: config.direction,
  })

  if (existsSync(file)) {
    appendFileSync(file, `${line}\n`)
    return
  }

  writeFileSync(file, `${line}\n`)
}

export const appendResultEntry = (directory: string, result: LoggedExperiment) => {
  ensureAutoresearchDir(directory)
  appendFileSync(
    logPath(directory),
    `${JSON.stringify({
      run: result.run,
      commit: result.commit,
      metric: result.metric,
      metrics: result.metrics,
      status: result.status,
      description: result.description,
      timestamp: result.timestamp,
    })}\n`,
  )
}

const parseLastRunRecord = (value: unknown): LastRunRecord | null => {
  if (!isRecord(value)) return null

  const command = readString(value, "command")
  const exitCode = value.exitCode
  const durationSeconds = readNumber(value, "durationSeconds")
  const benchmarkPassed = readBoolean(value, "benchmarkPassed")
  const benchmarkTimedOut = readBoolean(value, "benchmarkTimedOut")
  const benchmarkOutputTail = readString(value, "benchmarkOutputTail")
  const checksRan = readBoolean(value, "checksRan")
  const checksPassedValue = value.checksPassed
  const checksPassed = checksPassedValue === null || typeof checksPassedValue === "boolean" ? checksPassedValue : undefined
  const checksTimedOut = readBoolean(value, "checksTimedOut")
  const checksOutputTail = readString(value, "checksOutputTail")
  const timestamp = readNumber(value, "timestamp")

  if (
    command === null ||
    durationSeconds === null ||
    benchmarkPassed === null ||
    benchmarkTimedOut === null ||
    benchmarkOutputTail === null ||
    checksRan === null ||
    checksPassed === undefined ||
    checksTimedOut === null ||
    checksOutputTail === null ||
    timestamp === null
  ) {
    return null
  }

  if (!(exitCode === null || typeof exitCode === "number")) return null

  return {
    command,
    exitCode,
    durationSeconds,
    benchmarkPassed,
    benchmarkTimedOut,
    benchmarkOutputTail,
    checksRan,
    checksPassed,
    checksTimedOut,
    checksOutputTail,
    metrics: readMetricMap(value, "metrics"),
    timestamp,
  }
}

export const readLastRun = (directory: string): LastRunRecord | null => {
  const file = lastRunPath(directory)
  if (!existsSync(file)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return null
  }

  return parseLastRunRecord(parsed)
}

export const writeLastRun = (directory: string, record: LastRunRecord) => {
  ensureAutoresearchDir(directory)
  writeFileSync(lastRunPath(directory), JSON.stringify(record, null, 2))
}

export const clearLastRun = (directory: string) => {
  const file = lastRunPath(directory)
  if (existsSync(file)) unlinkSync(file)
}

export const splitMetrics = (metrics: MetricMap, primaryMetricName: string) => {
  const primaryMetric = metrics[primaryMetricName]
  const secondaryMetrics: MetricMap = {}

  for (const [metricName, value] of Object.entries(metrics)) {
    if (metricName === primaryMetricName) continue
    secondaryMetrics[metricName] = value
  }

  return {
    primaryMetric,
    secondaryMetrics,
  }
}

export const formatMetric = (value: number | null, unit: string) => {
  if (value === null) return "-"
  const prefix = Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")
  return `${prefix}${unit}`
}

export const buildStatusSummary = (state: ExperimentState, limit: number): string => {
  if (state.config === null) return "No autoresearch session configured."
  if (state.currentResults.length === 0) {
    return [
      `Session: ${state.config.name}`,
      `Primary: ${state.config.metricName} (${state.config.direction} is better)`,
      "Runs: 0",
    ].join("\n")
  }

  let keepCount = 0
  let discardCount = 0
  let crashCount = 0
  let checksFailedCount = 0

  for (const result of state.currentResults) {
    if (result.status === "keep") keepCount += 1
    if (result.status === "discard") discardCount += 1
    if (result.status === "crash") crashCount += 1
    if (result.status === "checks_failed") checksFailedCount += 1
  }

  const lines = [
    `Session: ${state.config.name}`,
    `Primary: ${state.config.metricName} (${state.config.direction} is better)`,
    `Runs: ${formatCount(state.currentResults.length, "run")} | ${keepCount} keep | ${discardCount} discard | ${crashCount} crash | ${checksFailedCount} checks_failed`,
    `Baseline: ${formatMetric(state.baselineMetric, state.config.metricUnit)}`,
    `Best keep: ${formatMetric(state.bestMetric, state.config.metricUnit)}`,
  ]

  const recent = state.currentResults.slice(-Math.max(limit, 1))
  lines.push("Recent:")
  for (const result of recent) {
    lines.push(
      `#${result.run} ${result.status} ${result.commit} ${formatMetric(result.metric, state.config.metricUnit)} ${result.description}`,
    )
  }

  if (state.knownSecondaryMetrics.length > 0) {
    lines.push(`Secondary: ${state.knownSecondaryMetrics.join(", ")}`)
  }

  return lines.join("\n")
}

export const currentHead = async (directory: string): Promise<string> => {
  const result = await runProcess("git", ["rev-parse", "--short=7", "HEAD"], directory, 5000)
  if (result.exitCode !== 0) return "unknown"
  const head = result.stdout.trim()
  return head.length > 0 ? head : "unknown"
}

export const runProcess = async (
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<ProcessResult> => {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    })

    let stdout = ""
    let stderr = ""
    let timedOut = false
    let finished = false

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString()
      })
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString()
      })
    }

    const killTimer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
      setTimeout(() => {
        if (!finished) child.kill("SIGKILL")
      }, 1000).unref()
    }, timeoutMs)

    child.on("error", (error) => {
      clearTimeout(killTimer)
      reject(error)
    })

    child.on("close", (exitCode) => {
      finished = true
      clearTimeout(killTimer)
      resolve({
        stdout,
        stderr,
        exitCode,
        timedOut,
        durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(6)),
      })
    })
  })
}
