import type { AvailableCategory } from "../agents/dynamic-agent-prompt-builder"
import type { OhMyOpenCodeConfig } from "../config"
import type { Managers } from "../create-managers"
import { isInteractiveBashEnabled } from "../interactive-bash-availability"
import { log } from "../shared"
import { normalizeToolArgSchemas } from "./normalize-tool-arg-schemas"
import type { SkillContext } from "./skill-context"
import { createCoreTools } from "./tool-registry-core-tools"
import { defaultToolRegistryFactories, type ToolRegistryFactories } from "./tool-registry-factories"
import {
  createHashlineToolsRecord,
  createMonitorToolsRecord,
  createTaskToolsRecord,
} from "./tool-registry-gated-tools"
import {
  applyToolAvailabilityPolicy,
  mergeToolCapabilityRecords,
  resolveToolRegistryPolicy,
} from "./tool-registry-policy"
import { createTeamModeToolsRecord } from "./tool-registry-team-tools"
import type { PluginContext, ToolsRecord } from "./types"

export { trimToolsToCap } from "./tool-registry-trimming"

export type ToolRegistryResult = {
  filteredTools: ToolsRecord
  taskSystemEnabled: boolean
}

export function createToolRegistry(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  managers: Pick<Managers, "backgroundManager" | "tmuxSessionManager" | "skillMcpManager" | "modelFallbackControllerAccessor" | "monitorManager">
  skillContext: SkillContext
  availableCategories: AvailableCategory[]
  interactiveBashEnabled?: boolean
  toolFactories?: Partial<ToolRegistryFactories>
}): ToolRegistryResult {
  const {
    ctx,
    pluginConfig,
    managers,
    skillContext,
    availableCategories,
    interactiveBashEnabled = isInteractiveBashEnabled(),
    toolFactories,
  } = args
  const factories: ToolRegistryFactories = {
    ...defaultToolRegistryFactories,
    ...toolFactories,
  }
  const policy = resolveToolRegistryPolicy({
    pluginConfig,
    interactiveBashEnabled,
    hasMonitorManager: Boolean(managers.monitorManager),
  })
  const taskSystemEnabled = policy.taskSystemEnabled
  const allTools = mergeToolCapabilityRecords({
    core: createCoreTools({
      ctx,
      pluginConfig,
      managers,
      skillContext,
      availableCategories,
      factories,
    }),
    interactive_bash: policy.includeInteractiveBash ? { interactive_bash: factories.interactive_bash } : {},
    team_mode: policy.includeTeamModeTools ? createTeamModeToolsRecord({ pluginConfig, ctx, managers, factories }) : {},
    monitor: policy.includeMonitorTools ? createMonitorToolsRecord({ pluginConfig, ctx, managers, factories }) : {},
    task_system: createTaskToolsRecord({ taskSystemEnabled, pluginConfig, ctx, factories }),
    hashline: policy.includeHashlineTools ? createHashlineToolsRecord({ pluginConfig, ctx, factories }) : {},
  })

  const allToolNames = Object.keys(allTools)
  const teamToolCount = allToolNames.filter((toolName) => toolName.startsWith("team_")).length
  log("[tool-registry] Built tool registry", {
    totalTools: allToolNames.length,
    teamModeEnabled: pluginConfig.team_mode?.enabled ?? false,
    teamToolCount,
  })

  for (const toolDefinition of Object.values(allTools)) {
    normalizeToolArgSchemas(toolDefinition)
  }

  const filteredTools: ToolsRecord = applyToolAvailabilityPolicy(allTools, policy)

  return {
    filteredTools,
    taskSystemEnabled,
  }
}
