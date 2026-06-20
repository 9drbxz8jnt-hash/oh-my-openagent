import { z } from "zod"

export const MemoryConflictPolicySchema = z.enum([
  "user_prompt_then_local_execution_then_mempalace_preferences",
])

export const MemoryLocalWorkspaceConfigSchema = z.object({
  enabled: z.boolean().default(true),
})

export const MemoryMempalaceModeSchema = z.literal("optional")

export const MemoryMempalaceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  timeout_ms: z.number().int().min(25).max(2000).default(200),
  mode: MemoryMempalaceModeSchema.default("optional"),
})

export const MemoryAutoWriteConfigSchema = z.object({
  objective_facts: z.boolean().default(true),
  subjective_or_personal: z.boolean().default(false),
})

export const MemoryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  local_workspace: MemoryLocalWorkspaceConfigSchema.default({ enabled: true }),
  mempalace: MemoryMempalaceConfigSchema.default({
    enabled: false,
    timeout_ms: 200,
    mode: "optional",
  }),
  auto_write: MemoryAutoWriteConfigSchema.default({
    objective_facts: true,
    subjective_or_personal: false,
  }),
  conflict_policy: MemoryConflictPolicySchema.default(
    "user_prompt_then_local_execution_then_mempalace_preferences",
  ),
})

export type MemoryConflictPolicy = z.infer<typeof MemoryConflictPolicySchema>
export type MemoryLocalWorkspaceConfig = z.infer<typeof MemoryLocalWorkspaceConfigSchema>
export type MemoryMempalaceMode = z.infer<typeof MemoryMempalaceModeSchema>
export type MemoryMempalaceConfig = z.infer<typeof MemoryMempalaceConfigSchema>
export type MemoryAutoWriteConfig = z.infer<typeof MemoryAutoWriteConfigSchema>
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>
