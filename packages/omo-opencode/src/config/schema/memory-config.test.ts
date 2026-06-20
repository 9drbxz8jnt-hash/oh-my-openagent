/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { OhMyOpenCodeConfigSchema } from "./oh-my-opencode-config"

const DEFAULT_MEMORY_CONFIG = {
  enabled: false,
  local_workspace: {
    enabled: true,
  },
  mempalace: {
    enabled: false,
    timeout_ms: 200,
    mode: "optional",
  },
  auto_write: {
    objective_facts: true,
    subjective_or_personal: false,
  },
  conflict_policy: "user_prompt_then_local_execution_then_mempalace_preferences",
}

describe("OhMyOpenCodeConfigSchema memory", () => {
  test("#given memory section is present without overrides #when parsed #then memory defaults are applied", () => {
    const result = OhMyOpenCodeConfigSchema.parse({ memory: {} })

    expect(result.memory).toEqual(DEFAULT_MEMORY_CONFIG)
  })

  test("#given memory options are configured #when parsed #then configured values are preserved", () => {
    const input = {
      memory: {
        enabled: true,
        local_workspace: {
          enabled: false,
        },
        mempalace: {
          enabled: true,
          timeout_ms: 500,
          mode: "optional",
        },
        auto_write: {
          objective_facts: false,
          subjective_or_personal: true,
        },
        conflict_policy: "user_prompt_then_local_execution_then_mempalace_preferences",
      },
    }

    const result = OhMyOpenCodeConfigSchema.parse(input)

    expect(result.memory).toEqual(input.memory)
  })

  test("#given memory section is omitted #when parsed #then root memory defaults are applied", () => {
    const result = OhMyOpenCodeConfigSchema.parse({})

    expect(result.memory).toEqual(DEFAULT_MEMORY_CONFIG)
  })

  test("#given mempalace timeout is outside range #when parsed #then validation fails", () => {
    const below = OhMyOpenCodeConfigSchema.safeParse({
      memory: { mempalace: { timeout_ms: 24 } },
    })
    const above = OhMyOpenCodeConfigSchema.safeParse({
      memory: { mempalace: { timeout_ms: 2001 } },
    })

    expect(below.success).toBe(false)
    if (!below.success) expect(below.error.issues[0]?.path).toEqual(["memory", "mempalace", "timeout_ms"])
    expect(above.success).toBe(false)
    if (!above.success) expect(above.error.issues[0]?.path).toEqual(["memory", "mempalace", "timeout_ms"])
  })

  test("#given mempalace mode is required #when parsed #then MemPalace remains optional fallback only", () => {
    const result = OhMyOpenCodeConfigSchema.safeParse({
      memory: { mempalace: { mode: "required" } },
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["memory", "mempalace", "mode"])
  })
})
