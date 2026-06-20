export type McpEntry = Record<string, unknown>

type McpMergePolicyInput = {
  readonly builtinMcps: Record<string, McpEntry>
  readonly claudeCodeMcps: Record<string, McpEntry>
  readonly userMcp?: Record<string, unknown>
  readonly pluginMcps: Record<string, McpEntry>
  readonly disabledMcps: readonly string[]
}

type McpMergePolicyResult = {
  readonly merged: Record<string, McpEntry>
  readonly userOverridesClaudeCodeMcpNames: string[]
}

function isDisabledMcpEntry(value: unknown): value is McpEntry & { enabled: false } {
  return typeof value === "object" && value !== null && (value as McpEntry).enabled === false
}

function captureUserDisabledMcps(userMcp: Record<string, unknown> | undefined): Set<string> {
  const disabled = new Set<string>()
  if (!userMcp) return disabled

  for (const [name, value] of Object.entries(userMcp)) {
    if (isDisabledMcpEntry(value)) {
      disabled.add(name)
    }
  }

  return disabled
}

export function resolveMcpMergePolicy(input: McpMergePolicyInput): McpMergePolicyResult {
  const userDisabledMcps = captureUserDisabledMcps(input.userMcp)
  const userOverridesClaudeCodeMcpNames = input.userMcp
    ? Object.keys(input.userMcp).filter((name) => name in input.claudeCodeMcps)
    : []

  const merged = {
    ...input.builtinMcps,
    ...input.claudeCodeMcps,
    ...(input.userMcp ?? {}),
    ...input.pluginMcps,
  } as Record<string, McpEntry>

  for (const name of userDisabledMcps) {
    if (merged[name]) {
      merged[name] = { ...merged[name], enabled: false }
    }
  }

  const disabledSet = new Set(input.disabledMcps)
  for (const name of disabledSet) {
    delete merged[name]
  }

  return {
    merged,
    userOverridesClaudeCodeMcpNames,
  }
}
