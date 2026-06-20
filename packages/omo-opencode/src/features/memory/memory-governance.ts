import {
  classifyMemoryCandidate,
  type DurableMemoryCandidate,
  type MemoryCandidateInput,
  type MemoryConflict,
  type MemoryDecision,
  type MemoryRecord,
  type MemorySource,
} from "./contracts"

export type MemoryConflictResolution =
  | {
      readonly status: "resolved"
      readonly winner: DurableMemoryCandidate | MemoryRecord
      readonly reason: "candidate" | "active_user_prompt" | "current_workspace_evidence" | "newer_mempalace_preference"
    }
  | {
      readonly status: "needs_user_approval"
      readonly conflict: MemoryConflict
    }

function normalizeMemoryText(text: string): string {
  return text.trim().replace(/\s+/g, " ")
}

function sourceSubjectKey(source: MemorySource, content: string): string {
  return normalizeMemoryText(source.reference ?? source.label ?? content).toLowerCase()
}

function candidateSubjectKey(candidate: { readonly content: string; readonly source: MemorySource }): string {
  return sourceSubjectKey(candidate.source, candidate.content)
}

function recordSubjectKey(record: MemoryRecord): string {
  return sourceSubjectKey(record.source, record.content)
}

function toComparableTimestamp(input: { readonly recordedAt?: string; readonly source: MemorySource }): number {
  const timestamp = input.recordedAt ?? input.source.capturedAt ?? new Date(0).toISOString()
  const value = new Date(timestamp).getTime()
  return Number.isFinite(value) ? value : 0
}

function isWorkspaceEvidenceRecord(record: MemoryRecord): boolean {
  return (
    record.source.kind === "runtime_context" ||
    record.source.label.startsWith(".omo/evidence/") ||
    record.source.reference?.startsWith(".omo/evidence/") === true
  )
}

function isPreferenceRecord(record: MemoryRecord): boolean {
  return record.classification === "preference" && record.source.kind === "durable_memory"
}

function chooseNewest(records: readonly MemoryRecord[]): MemoryRecord | undefined {
  let newest: MemoryRecord | undefined
  let newestTimestamp = Number.NEGATIVE_INFINITY

  for (const record of records) {
    const timestamp = toComparableTimestamp(record)
    if (timestamp >= newestTimestamp) {
      newest = record
      newestTimestamp = timestamp
    }
  }

  return newest
}

function createConflict(
  candidate: DurableMemoryCandidate,
  existing: readonly MemoryRecord[],
  reason: MemoryConflict["reason"],
): MemoryConflict {
  return {
    id: `memory-conflict:${candidate.id}`,
    candidate,
    existing,
    reason,
  }
}

function candidateAsRecord(candidate: DurableMemoryCandidate): MemoryRecord {
  return {
    id: candidate.id,
    classification: candidate.classification,
    content: candidate.content,
    recordedAt: candidate.source.capturedAt ?? new Date().toISOString(),
    source: candidate.source,
  }
}

export function memoryCandidateIdempotencyKey(
  candidate: Pick<MemoryCandidateInput, "classification" | "content" | "source">,
): string {
  return JSON.stringify([
    candidate.classification,
    candidate.source.kind,
    candidateSubjectKey(candidate),
    normalizeMemoryText(candidate.content).toLowerCase(),
  ])
}

export function dedupeMemoryCandidates(candidates: readonly MemoryCandidateInput[]): MemoryCandidateInput[] {
  const seen = new Set<string>()
  const unique: MemoryCandidateInput[] = []

  for (const candidate of candidates) {
    const key = memoryCandidateIdempotencyKey(candidate)
    if (seen.has(key)) continue

    seen.add(key)
    unique.push(candidate)
  }

  return unique
}

export function resolveMemoryConflict(args: {
  readonly candidate: DurableMemoryCandidate
  readonly existing: readonly MemoryRecord[]
}): MemoryConflictResolution {
  const subjectKey = candidateSubjectKey(args.candidate)
  const sameSubject = args.existing.filter((record) => recordSubjectKey(record) === subjectKey)

  if (sameSubject.length === 0) {
    return { status: "resolved", winner: args.candidate, reason: "candidate" }
  }

  const activePromptWinner = chooseNewest(sameSubject.filter((record) => record.source.kind === "active_user_prompt"))
  if (activePromptWinner !== undefined) {
    return { status: "resolved", winner: activePromptWinner, reason: "active_user_prompt" }
  }

  const workspaceEvidenceWinner = chooseNewest(sameSubject.filter((record) => isWorkspaceEvidenceRecord(record)))
  if (workspaceEvidenceWinner !== undefined) {
    return { status: "resolved", winner: workspaceEvidenceWinner, reason: "current_workspace_evidence" }
  }

  const preferencePool = sameSubject.filter((record) => isPreferenceRecord(record))
  const candidateIsPreference = args.candidate.classification === "preference" && args.candidate.source.kind === "durable_memory"
  if (candidateIsPreference || preferencePool.length > 0) {
    const candidatePreferenceRecord = candidateIsPreference ? candidateAsRecord(args.candidate) : undefined
    const preferenceWinner = chooseNewest(candidatePreferenceRecord !== undefined ? [...preferencePool, candidatePreferenceRecord] : preferencePool)
    if (preferenceWinner !== undefined) {
      return {
        status: "resolved",
        winner: preferenceWinner.id === args.candidate.id ? args.candidate : preferenceWinner,
        reason: "newer_mempalace_preference",
      }
    }
  }

  return {
    status: "needs_user_approval",
    conflict: createConflict(args.candidate, sameSubject, "unverified_existing_memory"),
  }
}

export function governMemoryCandidateWrite(args: {
  readonly candidate: MemoryCandidateInput
  readonly existing?: readonly MemoryRecord[]
  readonly seenIdempotencyKeys?: readonly string[]
}): MemoryDecision {
  const classified = classifyMemoryCandidate(args.candidate)

  if (classified.status === "rejected") {
    return { status: "rejected", candidateId: classified.id, reason: classified.reason }
  }

  const idempotencyKey = memoryCandidateIdempotencyKey(classified)
  if (args.seenIdempotencyKeys?.includes(idempotencyKey)) {
    return { status: "skipped", candidateId: classified.id, reason: "duplicate" }
  }

  if (classified.requiresUserApproval) {
    return { status: "needs_user_approval", candidateId: classified.id, reason: "subjective_or_personal" }
  }

  const resolution = resolveMemoryConflict({ candidate: classified, existing: args.existing ?? [] })
  if (resolution.status === "needs_user_approval") {
    return { status: "needs_user_approval", candidateId: classified.id, reason: "conflict", conflict: resolution.conflict }
  }

  if (resolution.winner.id !== classified.id) {
    const reason = resolution.reason === "newer_mempalace_preference"
      ? "newer_source_disagrees"
      : "same_subject_different_value"
    return {
      status: "needs_user_approval",
      candidateId: classified.id,
      reason: "conflict",
      conflict: createConflict(classified, [resolution.winner as MemoryRecord], reason),
    }
  }

  return {
    status: "written",
    adapterId: "memory_governance",
    candidateId: classified.id,
    source: classified.source,
  }
}
