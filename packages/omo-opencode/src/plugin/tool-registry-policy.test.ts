/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { tool } from "@opencode-ai/plugin"

import { type OhMyOpenCodeConfig, OhMyOpenCodeConfigSchema } from "../config"
import {
  applyToolAvailabilityPolicy,
  mergeToolCapabilityRecords,
  resolveToolRegistryPolicy,
} from "./tool-registry-policy"

const fakeTool = tool({
  description: "test tool",
  args: {},
  async execute(): Promise<string> {
    return "ok"
  },
})

function createPluginConfig(overrides: Partial<OhMyOpenCodeConfig> = {}): OhMyOpenCodeConfig {
  return OhMyOpenCodeConfigSchema.parse({
    git_master: {
      commit_footer: false,
      include_co_authored_by: false,
      git_env_prefix: "",
    },
    ...overrides,
  })
}

describe("tool registry policy helpers", () => {
  test("filters disabled tools before returning the final registry", () => {
    const result = applyToolAvailabilityPolicy(
      {
        bash: fakeTool,
        grep: fakeTool,
        read: fakeTool,
      },
      {
        disabledTools: ["grep"],
      },
    )

    expect(Object.keys(result)).toEqual(["bash", "read"])
  })

  test("merges capability records in the registry capability order", () => {
    const result = mergeToolCapabilityRecords({
      hashline: { edit: fakeTool },
      task_system: { task_create: fakeTool },
      core: { bash: fakeTool },
      team_mode: { team_create: fakeTool },
    })

    expect(Object.keys(result)).toEqual(["bash", "team_create", "task_create", "edit"])
  })

  test("resolves enabled gates for team-mode, task-system, hashline, and interactive bash tools", () => {
    const policy = resolveToolRegistryPolicy({
      pluginConfig: createPluginConfig({
        team_mode: { enabled: true },
        experimental: { task_system: true },
        hashline_edit: true,
      }),
      interactiveBashEnabled: true,
      hasMonitorManager: false,
    })

    expect(policy.includeTeamModeTools).toBe(true)
    expect(policy.taskSystemEnabled).toBe(true)
    expect(policy.includeHashlineTools).toBe(true)
    expect(policy.includeInteractiveBash).toBe(true)
  })

  test("resolves disabled gates for team-mode and task-system tools by default", () => {
    const policy = resolveToolRegistryPolicy({
      pluginConfig: createPluginConfig(),
      interactiveBashEnabled: false,
      hasMonitorManager: false,
    })

    expect(policy.includeTeamModeTools).toBe(false)
    expect(policy.taskSystemEnabled).toBe(false)
    expect(policy.includeInteractiveBash).toBe(false)
  })
})
