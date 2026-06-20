import type { MemoryConfig } from "../../config/schema/memory-config"
import type {
  DurableMemoryCandidate,
  DurableMemoryClassification,
  MemoryAvailabilityResult,
  MemoryReadQuery,
  MemoryReadResult,
  MemoryRecord,
  MemorySource,
  MemorySourceKind,
  MemoryWriteResult,
} from "./contracts"
import {
  LOCAL_READ_RECORD_CHAR_LIMIT,
  MEMPALACE_ADAPTER_ID,
  createAvailableProbeResult,
  createAvailableReadResult,
  createMemorySource,
  createTimeoutResult,
  createUnavailableResult,
  errorMessage,
  isMemoryOutcomeError,
  normalizeQueryText,
  runWithTimeout,
  truncateContent,
} from "./memory-adapter-shared"

export interface MemPalaceMemoryHit {
  readonly id?: string
  readonly content: string
  readonly classification?: DurableMemoryClassification
  readonly recordedAt?: string
  readonly source?: Partial<MemorySource> & { readonly kind?: MemorySourceKind }
}

export interface MemPalaceMcpClient {
  status(): Promise<unknown>
  search(query: MemoryReadQuery): Promise<readonly MemPalaceMemoryHit[]>
  kgQuery(query: {
    readonly entity: string
    readonly direction?: "inbound" | "outbound" | "both"
    readonly as_of?: string
    readonly limit?: number
  }): Promise<readonly MemPalaceMemoryHit[]>
}

export interface MemPalaceMemoryAdapter {
  readonly id: string
  probe(query?: MemoryReadQuery): Promise<MemoryAvailabilityResult>
  read(query: MemoryReadQuery): Promise<MemoryReadResult>
  write(candidate: DurableMemoryCandidate): Promise<MemoryWriteResult>
}

function createMemPalaceDisabledResult(query: MemoryReadQuery): MemoryReadResult {
  const outOfScope = query.sources?.includes("durable_memory") === false
  return createUnavailableResult({
    adapterId: MEMPALACE_ADAPTER_ID,
    reason: outOfScope ? "out_of_scope" : "disabled",
    message: outOfScope ? "MemPalace is outside the requested source scope" : "MemPalace is disabled in config",
    source: createMemorySource("durable_memory", "MemPalace", query.query ? `query:${query.query}` : "mempalace_status"),
  })
}

function normalizeHits(hits: readonly MemPalaceMemoryHit[]): MemoryRecord[] {
  return hits.map((hit, index) => {
    const sourceKind = hit.source?.kind ?? "durable_memory"
    const source = createMemorySource(
      sourceKind,
      hit.source?.label ?? "MemPalace",
      hit.source?.reference ?? `mempalace://${hit.id ?? index}`,
      hit.recordedAt,
    )

    return {
      id: hit.id ?? `${MEMPALACE_ADAPTER_ID}:${index}`,
      classification: hit.classification ?? "objective_fact",
      content: truncateContent(hit.content, LOCAL_READ_RECORD_CHAR_LIMIT),
      recordedAt: hit.recordedAt ?? new Date().toISOString(),
      source,
    }
  })
}

async function probeMemPalace(args: {
  readonly client: MemPalaceMcpClient
  readonly timeoutMs: number
  readonly query: MemoryReadQuery
}): Promise<MemoryAvailabilityResult> {
  if (args.query.sources?.includes("durable_memory") === false) return createMemPalaceDisabledResult(args.query)

  const source = createMemorySource("durable_memory", "MemPalace", "mempalace_status")
  const outcome = await runWithTimeout({
    operation: async () => {
      await args.client.status()
      return createAvailableProbeResult({ adapterId: MEMPALACE_ADAPTER_ID, source })
    },
    timeoutMs: args.timeoutMs,
    onTimeout: () => createTimeoutResult({ adapterId: MEMPALACE_ADAPTER_ID, timeoutMs: args.timeoutMs, message: `MemPalace probe timed out after ${args.timeoutMs}ms`, source }),
    onFailure: (error) => createUnavailableResult({ adapterId: MEMPALACE_ADAPTER_ID, reason: "client_unavailable", message: errorMessage(error), source }),
  })

  return outcome
}

async function readFromMemPalace(args: {
  readonly client: MemPalaceMcpClient
  readonly timeoutMs: number
  readonly query: MemoryReadQuery
}): Promise<MemoryReadResult> {
  const probe = await probeMemPalace(args)
  if (probe.status !== "available") return probe

  const searchOutcome = await runWithTimeout({
    operation: async () => args.client.search(args.query),
    timeoutMs: args.timeoutMs,
    onTimeout: () => createTimeoutResult({ adapterId: MEMPALACE_ADAPTER_ID, timeoutMs: args.timeoutMs, message: `MemPalace search timed out after ${args.timeoutMs}ms`, source: createMemorySource("durable_memory", "MemPalace", "mempalace_search") }),
    onFailure: (error) => createUnavailableResult({ adapterId: MEMPALACE_ADAPTER_ID, reason: "request_failed", message: errorMessage(error), source: createMemorySource("durable_memory", "MemPalace", "mempalace_search") }),
  })

  if (isMemoryOutcomeError(searchOutcome)) return searchOutcome

  let hits = [...searchOutcome]
  const normalizedQuery = normalizeQueryText(args.query.query)
  const shouldQueryKg = normalizedQuery.split(/\s+/).length <= 3 && normalizedQuery.length <= 64
  if (hits.length === 0 && shouldQueryKg) {
    const kgOutcome = await runWithTimeout({
      operation: async () => args.client.kgQuery({ entity: normalizedQuery, direction: "both", limit: args.query.limit }),
      timeoutMs: args.timeoutMs,
      onTimeout: () => createTimeoutResult({ adapterId: MEMPALACE_ADAPTER_ID, timeoutMs: args.timeoutMs, message: `MemPalace kg_query timed out after ${args.timeoutMs}ms`, source: createMemorySource("durable_memory", "MemPalace", "mempalace_kg_query") }),
      onFailure: (error) => createUnavailableResult({ adapterId: MEMPALACE_ADAPTER_ID, reason: "request_failed", message: errorMessage(error), source: createMemorySource("durable_memory", "MemPalace", "mempalace_kg_query") }),
    })
    if (isMemoryOutcomeError(kgOutcome)) return kgOutcome
    hits = [...hits, ...kgOutcome]
  }

  return createAvailableReadResult({
    adapterId: MEMPALACE_ADAPTER_ID,
    source: createMemorySource("durable_memory", "MemPalace", "mempalace_search"),
    records: normalizeHits(hits).slice(0, Math.max(1, args.query.limit ?? 10)),
  })
}

export function createMemPalaceMemoryAdapter(args: {
  readonly client: MemPalaceMcpClient
  readonly memory: MemoryConfig
}): MemPalaceMemoryAdapter {
  return {
    id: MEMPALACE_ADAPTER_ID,
    async probe(query: MemoryReadQuery = { query: "", limit: 1 }): Promise<MemoryAvailabilityResult> {
      if (!args.memory.enabled || !args.memory.mempalace.enabled) return createMemPalaceDisabledResult(query)
      return await probeMemPalace({ client: args.client, timeoutMs: args.memory.mempalace.timeout_ms, query })
    },
    async read(query: MemoryReadQuery): Promise<MemoryReadResult> {
      if (!args.memory.enabled || !args.memory.mempalace.enabled) return createMemPalaceDisabledResult(query)
      return await readFromMemPalace({ client: args.client, timeoutMs: args.memory.mempalace.timeout_ms, query })
    },
    async write(candidate: DurableMemoryCandidate): Promise<MemoryWriteResult> {
      if (!args.memory.enabled) return { status: "skipped", candidateId: candidate.id, reason: "disabled" }
      return { status: "skipped", candidateId: candidate.id, reason: "write_unavailable" }
    },
  }
}
