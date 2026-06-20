export type RuntimeHookTemperature = "hot" | "warm" | "bounded" | "cold" | "cold-safe"

export type RuntimeHookMemoryPolicy = "forbidden" | "read-only" | "read-write"

export type RuntimeHookViolationKind = "memory-import" | "memory-write"

export type RuntimeHookViolation = {
  kind: RuntimeHookViolationKind
  filePath: string
  line: number
}

export type RuntimeHookTier = {
  name: string
  hookCount: number
  hotHooks: readonly string[]
  boundedHooks: readonly string[]
  coldHooks: readonly string[]
  coldSafeHooks: readonly string[]
}

export type RuntimeHookSurfacePolicy = Record<RuntimeHookTemperature, {
  memoryPolicy: RuntimeHookMemoryPolicy
  signals: readonly string[]
}>

export type RuntimeHookRestrictedPathRule = {
  path: string
  signals: readonly string[]
}

export type RuntimeHookContract = {
  tiers: readonly RuntimeHookTier[]
  surfacePolicy: RuntimeHookSurfacePolicy
  restrictedPaths: readonly RuntimeHookRestrictedPathRule[]
}

export const RUNTIME_HOOK_CONTRACT = {
  tiers: [
    {
      name: "Session Hooks",
      hookCount: 24,
      hotHooks: [
        "think-mode",
        "model-fallback",
        "agent-usage-reminder",
        "non-interactive-env",
        "interactive-bash-session",
        "ralph-loop",
        "edit-error-recovery",
        "delegate-task-retry",
        "start-work",
        "prometheus-md-only",
        "sisyphus-junior-notepad",
        "question-label-truncator",
        "no-sisyphus-gpt",
        "no-hephaestus-non-gpt",
        "hephaestus-agents-md-injector",
        "legacy-plugin-toast",
      ] as const,
      boundedHooks: [
        "preemptive-compaction",
        "anthropic-context-window-limit-recovery",
        "task-resume-info",
        "runtime-fallback",
      ] as const,
      coldHooks: [
        "auto-update-checker",
        "codegraph-bootstrap",
        "ast-grep-sg-provision",
      ] as const,
      coldSafeHooks: ["session-notification"] as const,
    },
    {
      name: "Tool Guard Hooks",
      hookCount: 18,
      hotHooks: [
        "comment-checker",
        "tool-output-truncator",
        "directory-agents-injector",
        "directory-readme-injector",
        "empty-task-response-detector",
        "rules-injector",
        "tasks-todowrite-disabler",
        "write-existing-file-guard",
        "bash-file-read-guard",
        "hashline-read-enhancer",
        "json-error-recovery",
        "read-image-resizer",
        "todo-description-override",
        "webfetch-redirect-guard",
        "team-tool-gating",
        "fsync-skip-warning",
        "plan-format-validator",
        "notepad-write-guard",
      ] as const,
      boundedHooks: [] as const,
      coldHooks: [] as const,
      coldSafeHooks: [] as const,
    },
    {
      name: "Transform Hooks",
      hookCount: 7,
      hotHooks: [
        "claude-code-hooks",
        "keyword-detector",
        "contextInjectorMessagesTransform",
        "team-mode-status-injector",
        "team-mailbox-injector",
        "tool-pair-validator",
        "monitor-status-injector",
      ] as const,
      boundedHooks: [] as const,
      coldHooks: [] as const,
      coldSafeHooks: [] as const,
    },
    {
      name: "Continuation Hooks",
      hookCount: 7,
      hotHooks: ["stop-continuation-guard"] as const,
      boundedHooks: [] as const,
      coldHooks: [] as const,
      coldSafeHooks: [
        "compaction-context-injector",
        "compaction-todo-preserver",
        "todo-continuation-enforcer",
        "unstable-agent-babysitter",
        "background-notification",
        "atlas",
      ] as const,
    },
    {
      name: "Skill Hooks",
      hookCount: 2,
      hotHooks: ["category-skill-reminder", "auto-slash-command"] as const,
      boundedHooks: [] as const,
      coldHooks: [] as const,
      coldSafeHooks: [] as const,
    },
    {
      name: "Direct Event Handlers",
      hookCount: 4,
      hotHooks: [] as const,
      boundedHooks: [] as const,
      coldHooks: [] as const,
      coldSafeHooks: [
        "teamIdleWakeHint",
        "teamLeadOrphanHandler",
        "teamMemberErrorHandler",
        "teamMemberStatusHandler",
      ] as const,
    },
  ] as const,
  surfacePolicy: {
    hot: {
      memoryPolicy: "forbidden",
      signals: [
        "chat.message",
        "chat.params",
        "command.execute.before",
        "experimental.chat.messages.transform",
        "experimental.chat.system.transform",
        "tool.definition",
        "tool.execute.before",
        "tool.execute.after",
        "prompt-async-gate",
        "dispatchInternalPrompt",
        "skill-mcp-manager",
      ] as const,
    },
    warm: {
      memoryPolicy: "forbidden",
      signals: ["chat.headers"] as const,
    },
    bounded: {
      memoryPolicy: "read-only",
      signals: [
        "session setup enrichment",
        "session.created",
        "task-resume-info",
        "anthropic-context-window-limit-recovery",
        "runtime-fallback",
        "model-fallback",
        "preemptive-compaction",
      ] as const,
    },
    cold: {
      memoryPolicy: "read-only",
      signals: [
        "createHooks",
        "createPluginInterface",
        "plugin startup after config load",
      ] as const,
    },
    "cold-safe": {
      memoryPolicy: "read-write",
      signals: [
        "idle/background completion",
        "session.idle",
        "background-notification",
        "session-notification",
        "compaction-context-injector",
        "compaction-todo-preserver",
        "todo-continuation-enforcer",
        "unstable-agent-babysitter",
        "atlas",
        "explicit memory commands",
      ] as const,
    },
  },
  restrictedPaths: [
    {
      path: "packages/omo-opencode/src/plugin/chat-message.ts",
      signals: ["chat.message"],
    },
    {
      path: "packages/omo-opencode/src/plugin/chat-params.ts",
      signals: ["chat.params"],
    },
    {
      path: "packages/omo-opencode/src/plugin/tool-execute-before.ts",
      signals: ["tool.execute.before"],
    },
    {
      path: "packages/omo-opencode/src/plugin/tool-execute-after.ts",
      signals: ["tool.execute.after"],
    },
    {
      path: "packages/omo-opencode/src/shared/live-server-route.ts",
      signals: ["resolveDispatchClient", "tryResolveDispatchClientSync"],
    },
    {
      path: "packages/omo-opencode/src/tools/skill-mcp/tools.ts",
      signals: ["manager.callTool", "manager.readResource", "manager.getPrompt"],
    },
    {
      path: "packages/omo-opencode/src/features/skill-mcp-manager/http-client.ts",
      signals: ["skill-mcp-manager/http-client"],
    },
    {
      path: "packages/omo-opencode/src/features/skill-mcp-manager/stdio-client.ts",
      signals: ["skill-mcp-manager/stdio-client"],
    },
    {
      path: "packages/omo-opencode/src/features/skill-mcp-manager/connection.ts",
      signals: ["skill-mcp-manager/connection"],
    },
    {
      path: "packages/utils/src/prompt-async-gate.ts",
      signals: ["dispatchInternalPrompt"],
    },
  ] as const,
} satisfies RuntimeHookContract
