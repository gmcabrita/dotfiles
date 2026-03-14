import { tool } from "@opencode-ai/plugin"

import { scaffoldAutoresearchFiles } from "../lib/autoresearch.ts"

const formatGroup = (label: string, values: string[]) => {
  if (values.length === 0) return null
  return `${label}: ${values.join(", ")}`
}

export default tool({
  description: "Create canonical autoresearch scaffold files under autoresearch/.",
  args: {
    objective: tool.schema.string().describe("Plain-English optimization goal."),
    benchmark_command: tool.schema.string().describe("Benchmark command body for autoresearch/autoresearch.sh. Must emit METRIC lines or rely on wall_clock_s."),
    metric_name: tool.schema.string().describe("Primary metric name."),
    metric_unit: tool.schema.string().optional().describe("Primary metric unit, eg s, ms, kb, or empty string."),
    direction: tool.schema.enum(["lower", "higher"]).optional().describe("Whether lower or higher is better. Defaults to lower."),
    secondary_metrics: tool.schema.array(tool.schema.string()).optional().describe("Optional secondary metrics to track."),
    files_in_scope: tool.schema.array(tool.schema.string()).optional().describe("Files or directories in scope."),
    constraints: tool.schema.array(tool.schema.string()).optional().describe("Hard constraints or guardrails."),
    checks_command: tool.schema.string().optional().describe("Optional command body for autoresearch/autoresearch.checks.sh."),
    overwrite: tool.schema.boolean().optional().describe("Overwrite differing scaffold files. Defaults to false."),
  },
  async execute(args, context) {
    const result = scaffoldAutoresearchFiles(process.cwd(), {
      objective: args.objective,
      benchmarkCommand: args.benchmark_command,
      metricName: args.metric_name,
      metricUnit: args.metric_unit ?? "",
      direction: args.direction ?? "lower",
      secondaryMetrics: args.secondary_metrics ?? [],
      filesInScope: args.files_in_scope ?? [],
      constraints: args.constraints ?? [],
      checksCommand: args.checks_command ?? null,
      overwrite: args.overwrite ?? false,
    })

    const lines = [
      "Autoresearch scaffold ready under `autoresearch/`.",
      `Primary metric: ${args.metric_name} (${args.metric_unit ?? "unitless"}, ${args.direction ?? "lower"} is better)`,
    ]

    const created = formatGroup("Created", result.created)
    if (created !== null) lines.push(created)

    const updated = formatGroup("Updated", result.updated)
    if (updated !== null) lines.push(updated)

    const skipped = formatGroup("Skipped", result.skipped)
    if (skipped !== null) lines.push(skipped)

    if (args.checks_command === undefined) {
      lines.push("Checks script: not created")
    }

    lines.push("Next: review `autoresearch/autoresearch.md`, then call `init_experiment`.")
    return lines.join("\n")
  },
})
