import type {
  MemoryAvailabilityResultAvailable,
  MemoryReadResultAvailable,
  MemoryRecord,
  MemorySource,
  MemorySourceKind,
  MemoryTimeout,
  MemoryUnavailable,
  MemoryUnavailableReason,
} from "./contracts"

export const LOCAL_WORKSPACE_ADAPTER_ID = "local_workspace"
export const MEMPALACE_ADAPTER_ID = "mempalace"
export const ACTIVE_NOTEBOOK_ROOT = ".omo/notepads/runtime-hooks-agent-memory-architecture"
export const LOCAL_READ_RECORD_CHAR_LIMIT = 300
export const LOCAL_WRITE_CONTENT_LIMIT = 1_000

export function createMemorySource(
  kind: MemorySourceKind,
  label: string,
  reference?: string,
  capturedAt?: string,
): MemorySource {
  return { kind, label, reference, capturedAt }
}

export function createUnavailableResult(args: {
  readonly adapterId: string
  readonly reason: MemoryUnavailableReason
  readonly message: string
  readonly source?: MemorySource
}): MemoryUnavailable {
  return {
    status: "unavailable",
    adapterId: args.adapterId,
    reason: args.reason,
    message: args.message,
    source: args.source,
  }
}

export function createTimeoutResult(args: {
  readonly adapterId: string
  readonly timeoutMs: number
  readonly message: string
  readonly source?: MemorySource
}): MemoryTimeout {
  return {
    status: "timeout",
    adapterId: args.adapterId,
    timeoutMs: args.timeoutMs,
    message: args.message,
    source: args.source,
  }
}

export function createAvailableReadResult(args: {
  readonly adapterId: string
  readonly source: MemorySource
  readonly records: readonly MemoryRecord[]
  readonly fallback?: MemoryUnavailable | MemoryTimeout
}): MemoryReadResultAvailable {
  return {
    status: "available",
    adapterId: args.adapterId,
    source: args.source,
    records: args.records,
    fallback: args.fallback,
  }
}

export function createAvailableProbeResult(args: {
  readonly adapterId: string
  readonly source: MemorySource
}): MemoryAvailabilityResultAvailable {
  return {
    status: "available",
    adapterId: args.adapterId,
    source: args.source,
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function normalizeQueryText(query: string): string {
  return query.trim().replace(/\s+/g, " ")
}

export function matchesQuery(content: string, query: string): boolean {
  const normalizedQuery = normalizeQueryText(query)
  if (!normalizedQuery) return true

  const contentLower = content.toLowerCase()
  const tokens = normalizedQuery
    .split(/[^A-Za-z0-9_]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase())

  if (tokens.length === 0) return true
  return tokens.every((token) => contentLower.includes(token))
}

export function truncateContent(content: string, maxChars: number): string {
  const collapsed = content.trim().replace(/\s+/g, " ")
  if (collapsed.length <= maxChars) return collapsed
  if (maxChars <= 3) return "...".slice(0, maxChars)
  return `${collapsed.slice(0, maxChars - 3)}...`
}

export function isMemoryOutcomeError(outcome: unknown): outcome is MemoryTimeout | MemoryUnavailable {
  if (typeof outcome !== "object" || outcome === null || Array.isArray(outcome)) return false
  const status = (outcome as { readonly status?: unknown }).status
  return status === "timeout" || status === "unavailable"
}

export async function runWithTimeout<T>(args: {
  readonly operation: () => Promise<T>
  readonly timeoutMs: number
  readonly onTimeout: () => MemoryTimeout
  readonly onFailure: (error: unknown) => MemoryUnavailable
}): Promise<T | MemoryTimeout | MemoryUnavailable> {
  if (args.timeoutMs <= 0) {
    try {
      return await args.operation()
    } catch (error) {
      return args.onFailure(error)
    }
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const operationPromise = args.operation().catch((error: unknown) => args.onFailure(error))
  const timeoutPromise = new Promise<MemoryTimeout>((resolve) => {
    timeoutId = setTimeout(() => resolve(args.onTimeout()), args.timeoutMs)
  })

  try {
    return await Promise.race([operationPromise, timeoutPromise])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}
