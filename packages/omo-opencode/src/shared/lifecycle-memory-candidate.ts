import { appendFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

import { log as defaultLog } from "./logger"

export type LifecycleMemoryCandidateKind =
  | "background_task_completion"
  | "compact_summary"
  | "compact_recovery_summary"
  | "idle_run_summary"

export type LifecycleMemoryConfidence = "low" | "medium" | "high"

export interface LifecycleMemoryFact {
  fact: string
  source: string
  confidence: LifecycleMemoryConfidence
  why: string
}

export type LifecycleMemoryFactInput =
  | string
  | {
    fact?: string
    source?: string
    confidence?: LifecycleMemoryConfidence
    why?: string
  }

export interface LifecycleMemoryCandidate {
  id: string
  kind: LifecycleMemoryCandidateKind
  decisionOwner: "parent_supervisor"
  source: "background-agent" | "session-compacting"
  correlationId: string
  createdAt: string
  sessionID?: string
  parentSessionID?: string
  taskId?: string
  status?: string
  summary: string
  facts: LifecycleMemoryFact[]
}

export type LifecycleMemoryCandidateTraceEvent =
  | {
    type: "memory_candidate.created"
    correlationId: string
    candidateId: string
    kind: LifecycleMemoryCandidateKind
    sessionID?: string
    parentSessionID?: string
    taskId?: string
    bytes: number
  }
  | {
    type: "memory_candidate.write_failed" | "memory_candidate.local_summary_failed"
    correlationId: string
    candidateId: string
    kind: LifecycleMemoryCandidateKind
    sessionID?: string
    parentSessionID?: string
    taskId?: string
    error: string
  }

export interface LifecycleMemoryCandidateSink {
  submit: (candidate: LifecycleMemoryCandidate) => Promise<void> | void
}

export interface LifecycleMemoryCandidateLocalStore {
  append: (candidate: LifecycleMemoryCandidate) => Promise<void> | void
}

export interface LifecycleMemoryCandidateRecorder {
  record: (candidate: LifecycleMemoryCandidate) => Promise<void>
}

export type LifecycleMemoryCandidateTrace = (event: LifecycleMemoryCandidateTraceEvent) => void

const MAX_CANDIDATE_BYTES = 1024
const MAX_TEXT_CHARS = 220
const MAX_SOURCE_CHARS = 140
const MAX_FACTS = 3

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function truncateText(value: string, maxChars: number): string {
  const normalized = normalizeWhitespace(value)
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8")
}

function normalizeFactInput(input: LifecycleMemoryFactInput): LifecycleMemoryFact | null {
  if (typeof input === "string") {
    const fact = truncateText(input, MAX_TEXT_CHARS)
    if (!fact) return null
    return {
      fact,
      source: "supervisor_launch",
      confidence: "medium",
      why: "Supervisor provided this durable learning as a launch-time memory candidate.",
    }
  }

  const fact = truncateText(input.fact ?? "", MAX_TEXT_CHARS)
  if (!fact) return null

  return {
    fact,
    source: truncateText(input.source ?? "supervisor_launch", MAX_SOURCE_CHARS),
    confidence: input.confidence ?? "medium",
    why: truncateText(
      input.why ?? "Supervisor provided this durable learning as a launch-time memory candidate.",
      MAX_TEXT_CHARS,
    ),
  }
}

export function normalizeLifecycleMemoryFactInputs(inputs: readonly LifecycleMemoryFactInput[] | undefined): LifecycleMemoryFact[] | undefined {
  const facts = (inputs ?? [])
    .map(normalizeFactInput)
    .filter((fact): fact is LifecycleMemoryFact => fact !== null)
    .slice(0, MAX_FACTS)

  return facts.length > 0 ? facts : undefined
}

function buildCandidateId(input: {
  kind: LifecycleMemoryCandidateKind
  sessionID?: string
  taskId?: string
}): string {
  const sessionPart = input.sessionID ?? "no-session"
  const taskPart = input.taskId ?? "no-task"
  return `${input.kind}:${sessionPart}:${taskPart}`
}

function buildCorrelationId(input: {
  kind: LifecycleMemoryCandidateKind
  sessionID?: string
  parentSessionID?: string
  taskId?: string
}): string {
  const sessionPart = input.sessionID ?? input.parentSessionID ?? "no-session"
  const taskPart = input.taskId ?? "no-task"
  return `memory:${input.kind}:${sessionPart}:${taskPart}`
}

function enforceCandidateBudget(candidate: LifecycleMemoryCandidate): LifecycleMemoryCandidate {
  let bounded: LifecycleMemoryCandidate = {
    ...candidate,
    summary: truncateText(candidate.summary, MAX_TEXT_CHARS),
    facts: candidate.facts.slice(0, MAX_FACTS).map((fact) => ({
      fact: truncateText(fact.fact, MAX_TEXT_CHARS),
      source: truncateText(fact.source, MAX_SOURCE_CHARS),
      confidence: fact.confidence,
      why: truncateText(fact.why, MAX_TEXT_CHARS),
    })),
  }

  while (byteLength(bounded) > MAX_CANDIDATE_BYTES && bounded.facts.length > 1) {
    bounded = { ...bounded, facts: bounded.facts.slice(0, -1) }
  }

  if (byteLength(bounded) <= MAX_CANDIDATE_BYTES) return bounded

  bounded = {
    ...bounded,
    summary: truncateText(bounded.summary, 120),
    facts: bounded.facts.slice(0, 1).map((fact) => ({
      fact: truncateText(fact.fact, 120),
      source: truncateText(fact.source, 80),
      confidence: fact.confidence,
      why: truncateText(fact.why, 120),
    })),
  }

  if (byteLength(bounded) <= MAX_CANDIDATE_BYTES) return bounded

  return {
    ...bounded,
    summary: truncateText(bounded.summary, 80),
    facts: [],
  }
}

function createCandidate(input: {
  kind: LifecycleMemoryCandidateKind
  source: LifecycleMemoryCandidate["source"]
  summary: string
  facts: LifecycleMemoryFact[]
  sessionID?: string
  parentSessionID?: string
  taskId?: string
  status?: string
}): LifecycleMemoryCandidate {
  const correlationId = buildCorrelationId(input)
  return enforceCandidateBudget({
    id: buildCandidateId(input),
    kind: input.kind,
    decisionOwner: "parent_supervisor",
    source: input.source,
    correlationId,
    createdAt: new Date().toISOString(),
    ...(input.sessionID ? { sessionID: input.sessionID } : {}),
    ...(input.parentSessionID ? { parentSessionID: input.parentSessionID } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.status ? { status: input.status } : {}),
    summary: input.summary,
    facts: input.facts,
  })
}

export function buildBackgroundTaskCompletionMemoryCandidate(input: {
  task: {
    id: string
    sessionId?: string
    parentSessionId: string
    description: string
    agent: string
    status: string
    category?: string
    memoryCandidates?: LifecycleMemoryFactInput[]
  }
  completionSource: string
}): LifecycleMemoryCandidate {
  const explicitFacts = normalizeLifecycleMemoryFactInputs(input.task.memoryCandidates) ?? []

  const fallbackFact: LifecycleMemoryFact = {
    fact: truncateText(
      `Background task ${input.task.id} finished with status ${input.task.status}: ${input.task.description}`,
      MAX_TEXT_CHARS,
    ),
    source: "background-agent",
    confidence: "low",
    why: "Local lifecycle summary for parent supervisor review; not an automatic durable memory write.",
  }

  return createCandidate({
    kind: "background_task_completion",
    source: "background-agent",
    sessionID: input.task.sessionId,
    parentSessionID: input.task.parentSessionId,
    taskId: input.task.id,
    status: input.task.status,
    summary: `Background task ${input.task.id} completed via ${input.completionSource}; agent=${input.task.agent}; category=${input.task.category ?? "unspecified"}.`,
    facts: explicitFacts.length > 0 ? explicitFacts : [fallbackFact],
  })
}

export function buildCompactionLifecycleMemoryCandidate(input: {
  sessionID: string
  phase: "compact" | "recovery"
  agent?: string
}): LifecycleMemoryCandidate {
  const kind: LifecycleMemoryCandidateKind = input.phase === "compact"
    ? "compact_summary"
    : "compact_recovery_summary"
  const summary = input.phase === "compact"
    ? `Compaction capture completed for session ${input.sessionID}.`
    : `Compaction recovery autocontinue completed for session ${input.sessionID}.`

  return createCandidate({
    kind,
    source: "session-compacting",
    sessionID: input.sessionID,
    status: input.phase,
    summary,
    facts: [
      {
        fact: summary,
        source: "session-compacting",
        confidence: "low",
        why: "Small local lifecycle summary for supervisor governance after compaction.",
      },
    ],
  })
}

export function createLocalLifecycleMemoryCandidateStore(workspaceRoot: string): LifecycleMemoryCandidateLocalStore {
  const filePath = join(workspaceRoot, ".omo", "memory-candidates", "lifecycle.jsonl")
  return {
    append(candidate) {
      mkdirSync(dirname(filePath), { recursive: true })
      appendFileSync(filePath, `${JSON.stringify(candidate)}\n`, "utf8")
    },
  }
}

export function createLifecycleMemoryCandidateRecorder(args: {
  workspaceRoot: string
  sink?: LifecycleMemoryCandidateSink
  localStore?: LifecycleMemoryCandidateLocalStore
  trace?: LifecycleMemoryCandidateTrace
  log?: typeof defaultLog
}): LifecycleMemoryCandidateRecorder {
  const localStore = args.localStore ?? createLocalLifecycleMemoryCandidateStore(args.workspaceRoot)
  const logger = args.log ?? defaultLog

  function trace(event: LifecycleMemoryCandidateTraceEvent): void {
    try {
      args.trace?.(event)
    } catch (error) {
      logger("[lifecycle-memory] trace sink failed", {
        correlationId: event.correlationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    async record(candidate) {
      trace({
        type: "memory_candidate.created",
        correlationId: candidate.correlationId,
        candidateId: candidate.id,
        kind: candidate.kind,
        sessionID: candidate.sessionID,
        parentSessionID: candidate.parentSessionID,
        taskId: candidate.taskId,
        bytes: byteLength(candidate),
      })

      if (args.sink) {
        try {
          await args.sink.submit(candidate)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          trace({
            type: "memory_candidate.write_failed",
            correlationId: candidate.correlationId,
            candidateId: candidate.id,
            kind: candidate.kind,
            sessionID: candidate.sessionID,
            parentSessionID: candidate.parentSessionID,
            taskId: candidate.taskId,
            error: message,
          })
          logger("[lifecycle-memory] candidate sink failed", {
            correlationId: candidate.correlationId,
            candidateId: candidate.id,
            kind: candidate.kind,
            sessionID: candidate.sessionID,
            parentSessionID: candidate.parentSessionID,
            taskId: candidate.taskId,
            error: message,
          })
        }
      }

      try {
        await localStore.append(candidate)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        trace({
          type: "memory_candidate.local_summary_failed",
          correlationId: candidate.correlationId,
          candidateId: candidate.id,
          kind: candidate.kind,
          sessionID: candidate.sessionID,
          parentSessionID: candidate.parentSessionID,
          taskId: candidate.taskId,
          error: message,
        })
        logger("[lifecycle-memory] local summary write failed", {
          correlationId: candidate.correlationId,
          candidateId: candidate.id,
          kind: candidate.kind,
          sessionID: candidate.sessionID,
          parentSessionID: candidate.parentSessionID,
          taskId: candidate.taskId,
          error: message,
        })
      }
    },
  }
}
