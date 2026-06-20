export type MemorySourceKind =
  | "active_user_prompt"
  | "agent_report"
  | "durable_memory"
  | "local_workspace"
  | "runtime_context"

export interface MemorySource {
  readonly kind: MemorySourceKind
  readonly label: string
  readonly reference?: string
  readonly capturedAt?: string
}

export type DurableMemoryClassification =
  | "decision"
  | "objective_fact"
  | "preference"
  | "temporal_fact"
  | "diary_summary"
  | "subjective_or_personal"

export type RejectedMemoryClassification =
  | "large_prompt_dump"
  | "provider_response"
  | "raw_log_blob"
  | "secret_or_credential"
  | "transient_error"
  | "transient_command_output"
  | "unverified_summary"

export type MemoryCandidateClassification = DurableMemoryClassification | RejectedMemoryClassification

export interface MemoryCandidateInput {
  readonly id: string
  readonly classification: MemoryCandidateClassification
  readonly content: string
  readonly source: MemorySource
}

interface MemoryCandidateBase {
  readonly id: string
  readonly content: string
  readonly source: MemorySource
}

export interface DurableMemoryCandidate extends MemoryCandidateBase {
  readonly status: "accepted"
  readonly classification: DurableMemoryClassification
  readonly requiresUserApproval: boolean
}

export interface RejectedMemoryCandidate extends MemoryCandidateBase {
  readonly status: "rejected"
  readonly classification: RejectedMemoryClassification
  readonly reason: string
}

export type MemoryCandidate = DurableMemoryCandidate | RejectedMemoryCandidate

export interface MemoryReadQuery {
  readonly query: string
  readonly limit?: number
  readonly sources?: readonly MemorySourceKind[]
}

export interface MemoryRecord {
  readonly id: string
  readonly classification: DurableMemoryClassification
  readonly content: string
  readonly recordedAt: string
  readonly source: MemorySource
}

export interface MemoryReadAdapter {
  readonly id: string
  read(query: MemoryReadQuery): Promise<readonly MemoryRecord[]>
}

export interface MemoryWriteAdapter {
  readonly id: string
  write(candidate: DurableMemoryCandidate): Promise<MemoryDecision>
}

export type MemoryConflictReason =
  | "newer_source_disagrees"
  | "same_subject_different_value"
  | "unverified_existing_memory"

export interface MemoryConflict {
  readonly id: string
  readonly candidate: DurableMemoryCandidate
  readonly existing: readonly MemoryRecord[]
  readonly reason: MemoryConflictReason
}

export type MemoryDecision =
  | {
      readonly status: "written"
      readonly adapterId: string
      readonly candidateId: string
      readonly source: MemorySource
    }
  | {
      readonly status: "skipped"
      readonly candidateId: string
      readonly reason: "disabled" | "duplicate" | "not_durable" | "write_unavailable"
    }
  | {
      readonly status: "needs_user_approval"
      readonly candidateId: string
      readonly reason: "conflict"
      readonly conflict: MemoryConflict
    }
  | {
      readonly status: "needs_user_approval"
      readonly candidateId: string
      readonly reason: "subjective_or_personal"
      readonly conflict?: MemoryConflict
    }
  | {
      readonly status: "rejected"
      readonly candidateId: string
      readonly reason: string
    }

export type MemoryUnavailableReason =
  | "disabled"
  | "client_unavailable"
  | "request_failed"
  | "out_of_scope"
  | "write_unavailable"
  | "invalid_response"

export interface MemoryUnavailable {
  readonly status: "unavailable"
  readonly adapterId: string
  readonly reason: MemoryUnavailableReason
  readonly message: string
  readonly source?: MemorySource
}

export interface MemoryTimeout {
  readonly status: "timeout"
  readonly adapterId: string
  readonly timeoutMs: number
  readonly message: string
  readonly source?: MemorySource
}

export interface MemoryAvailabilityResultAvailable {
  readonly status: "available"
  readonly adapterId: string
  readonly source: MemorySource
}

export type MemoryAvailabilityResult = MemoryAvailabilityResultAvailable | MemoryUnavailable | MemoryTimeout

export interface MemoryReadResultAvailable {
  readonly status: "available"
  readonly adapterId: string
  readonly source: MemorySource
  readonly records: readonly MemoryRecord[]
  readonly fallback?: MemoryUnavailable | MemoryTimeout
}

export type MemoryReadResult = MemoryReadResultAvailable | MemoryUnavailable | MemoryTimeout

export type MemoryWriteResult = MemoryDecision | MemoryUnavailable | MemoryTimeout

export { classifyMemoryCandidate } from "./memory-classifier"
