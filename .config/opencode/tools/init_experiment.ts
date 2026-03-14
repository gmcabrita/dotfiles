import { tool } from "@opencode-ai/plugin"

import { loadExperimentState, writeConfigEntry } from "../lib/autoresearch.ts"

export default tool({
  description: "Initialize or reinitialize an autoresearch session.",
  args: {
    name: tool.schema.string().describe("Human-readable experiment name."),
    metric_name: tool.schema.string().describe("Primary metric name. Must match a METRIC name emitted by the benchmark, or `wall_clock_s`."),
    metric_unit: tool.schema.string().optional().describe("Primary metric unit, eg `s`, `ms`, `kb`, or empty string."),
    direction: tool.schema.enum(["lower", "higher"]).optional().describe("Whether lower or higher is better. Defaults to lower."),
  },
  async execute(args, context) {
    const directory = process.cwd()
    const state = loadExperimentState(directory)

    writeConfigEntry(directory, {
      name: args.name,
      metricName: args.metric_name,
      metricUnit: args.metric_unit ?? "",
      direction: args.direction ?? "lower",
    })

    const nextSegment = state.config === null ? 0 : state.currentSegment + 1
    const mode = state.config === null ? "initialized" : "reinitialized"

    return [
      `Autoresearch ${mode}.`,
      `Segment: ${nextSegment}`,
      `Name: ${args.name}`,
      `Primary metric: ${args.metric_name} (${args.metric_unit ?? "unitless"}, ${args.direction ?? "lower"} is better)`,
      "Next: run the baseline with run_experiment, then log it with log_experiment.",
    ].join("\n")
  },
})
