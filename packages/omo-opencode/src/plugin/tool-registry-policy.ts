import type { OhMyOpenCodeConfig } from "../config"
import { isTaskSystemEnabled } from "../shared"
import { filterDisabledTools } from "../shared/disabled-tools"
import { trimToolsToCap } from "./tool-registry-trimming"
import type { ToolsRecord } from "./types"

export const TOOL_REGISTRY_CAPABILITY_ORDER = [
  "core",
  "interactive_bash",
  "team_mode",
  "monitor",
  "task_system",
  "hashline",
] as const

export type ToolRegistryCapability = (typeof TOOL_REGISTRY_CAPABILITY_ORDER)[number]

export type ToolRegistryPolicy = {
  readonly disabledTools?: readonly string[]
  readonly maxTools?: number
  readonly includeInteractiveBash: boolean
  readonly includeTeamModeTools: boolean
  readonly includeMonitorTools: boolean
  readonly includeHashlineTools: boolean
  readonly taskSystemEnabled: boolean
}

export function resolveToolRegistryPolicy(args: {
  readonly pluginConfig: OhMyOpenCodeConfig
  readonly interactiveBashEnabled: boolean
  readonly hasMonitorManager: boolean
}): ToolRegistryPolicy {
  const { pluginConfig, interactiveBashEnabled, hasMonitorManager } = args

  return {
    disabledTools: pluginConfig.disabled_tools,
    maxTools: pluginConfig.experimental?.max_tools,
    includeInteractiveBash: interactiveBashEnabled,
    includeTeamModeTools: Boolean(pluginConfig.team_mode?.enabled),
    includeMonitorTools: Boolean(pluginConfig.monitor?.enabled && hasMonitorManager),
    includeHashlineTools: Boolean(pluginConfig.hashline_edit),
    taskSystemEnabled: isTaskSystemEnabled(pluginConfig),
  }
}

export function mergeToolCapabilityRecords(
  recordsByCapability: Partial<Record<ToolRegistryCapability, ToolsRecord>>,
): ToolsRecord {
  const merged: ToolsRecord = {}

  for (const capability of TOOL_REGISTRY_CAPABILITY_ORDER) {
    Object.assign(merged, recordsByCapability[capability] ?? {})
  }

  return merged
}

export function applyToolAvailabilityPolicy(
  tools: ToolsRecord,
  policy: Pick<ToolRegistryPolicy, "disabledTools" | "maxTools">,
): ToolsRecord {
  const filteredTools = filterDisabledTools(tools, policy.disabledTools)

  if (policy.maxTools) {
    trimToolsToCap(filteredTools, policy.maxTools)
  }

  return filteredTools
}
