import type {
  DurableMemoryCandidate,
  DurableMemoryClassification,
  MemoryCandidate,
  MemoryCandidateClassification,
  MemoryCandidateInput,
  RejectedMemoryCandidate,
  RejectedMemoryClassification,
} from "./contracts"

const rejectedMemoryReasons: Record<RejectedMemoryClassification, string> = {
  large_prompt_dump: "large_prompt_dump is transient context and must not become durable memory",
  provider_response: "provider_response is untrusted external output and must not become durable memory",
  raw_log_blob: "raw_log_blob must be summarized and reclassified before durable memory writes",
  secret_or_credential: "secret_or_credential must never become durable memory",
  transient_error: "transient_error is an ephemeral failure and must not become durable memory",
  transient_command_output: "transient_command_output must be converted into source-backed facts first",
  unverified_summary: "unverified_summary requires verification before durable memory writes",
}

const rejectedMemoryClassifications = new Set<MemoryCandidateClassification>([
  "large_prompt_dump",
  "provider_response",
  "raw_log_blob",
  "secret_or_credential",
  "transient_error",
  "transient_command_output",
  "unverified_summary",
])

const rawLogContentMarkers = [
  /^Command:/m,
  /^Output:/m,
  /\b\d+ pass\b/i,
  /\b\d+ fail\b/i,
  /\bRan \d+ tests across \d+ files\b/i,
  /\bexit \d+\b/i,
]

const secretLabelPatternSources = [
  String.raw`\b[A-Za-z0-9_-]*api[_-]?key\b`,
  String.raw`\b[A-Za-z0-9_-]*secret[_-]?key\b`,
  String.raw`\b[A-Za-z0-9_-]*access[_-]?token\b`,
  String.raw`\b[A-Za-z0-9_-]*refresh[_-]?token\b`,
  String.raw`\b[A-Za-z0-9_-]*bearer[_-]?token\b`,
  String.raw`\b[A-Za-z0-9_-]*session[_-]?token\b`,
]

const secretContentPatternSources = [
  String.raw`\bsk-(?:proj|live|test)?-[A-Za-z0-9_-]{16,}\b`,
  String.raw`\bapi[_-]?key\b[\s:=]+["']?[A-Za-z0-9._-]{8,}["']?`,
  String.raw`\bsecret[_-]?key\b[\s:=]+["']?[A-Za-z0-9._-]{8,}["']?`,
  String.raw`\btoken\b[\s:=]+["']?[A-Za-z0-9._-]{8,}["']?`,
  String.raw`\bgh[pousr]_[A-Za-z0-9]{16,}\b`,
  String.raw`\bAKIA[0-9A-Z]{16}\b`,
  String.raw`\bxox[baprs]-[A-Za-z0-9-]{10,}\b`,
]

function isRejectedMemoryClassification(
  classification: MemoryCandidateClassification,
): classification is RejectedMemoryClassification {
  return rejectedMemoryClassifications.has(classification)
}

function looksLikeRawLogBlob(content: string): boolean {
  const nonEmptyLineCount = content.split(/\r?\n/).filter((line) => line.trim().length > 0).length
  if (nonEmptyLineCount < 3) return false

  const markerCount = rawLogContentMarkers.filter((marker) => marker.test(content)).length
  return markerCount >= 2
}

function containsSensitiveContent(content: string): boolean {
  return [...secretLabelPatternSources, ...secretContentPatternSources].some((patternSource) =>
    new RegExp(patternSource, "i").test(content),
  )
}

function redactSensitiveContent(content: string): string {
  const redactedLabels = secretLabelPatternSources.reduce(
    (redacted, patternSource) => redacted.replace(new RegExp(patternSource, "gi"), "[REDACTED]"),
    content,
  )

  return secretContentPatternSources.reduce(
    (redacted, patternSource) => redacted.replace(new RegExp(patternSource, "gi"), "[REDACTED]"),
    redactedLabels,
  )
}

function createRejectedCandidate(args: {
  readonly input: MemoryCandidateInput
  readonly classification: RejectedMemoryClassification
  readonly content?: string
}): RejectedMemoryCandidate {
  return {
    id: args.input.id,
    classification: args.classification,
    content: args.content ?? redactSensitiveContent(args.input.content),
    reason: rejectedMemoryReasons[args.classification],
    source: args.input.source,
    status: "rejected",
  }
}

function createAcceptedCandidate(args: {
  readonly input: MemoryCandidateInput
  readonly classification: DurableMemoryClassification
  readonly requiresUserApproval: boolean
}): DurableMemoryCandidate {
  return {
    id: args.input.id,
    classification: args.classification,
    content: args.input.content,
    requiresUserApproval: args.requiresUserApproval,
    source: args.input.source,
    status: "accepted",
  }
}

export function classifyMemoryCandidate(input: MemoryCandidateInput): MemoryCandidate {
  if (containsSensitiveContent(input.content)) {
    return createRejectedCandidate({
      input,
      classification: "secret_or_credential",
      content: redactSensitiveContent(input.content),
    })
  }

  if (isRejectedMemoryClassification(input.classification)) {
    const content = input.classification === "raw_log_blob" || looksLikeRawLogBlob(input.content)
      ? "[REDACTED raw_log_blob]"
      : `[REDACTED ${input.classification}]`
    return createRejectedCandidate({ input, classification: input.classification, content })
  }

  if (looksLikeRawLogBlob(input.content)) {
    return createRejectedCandidate({ input, classification: "raw_log_blob", content: "[REDACTED raw_log_blob]" })
  }

  if (input.classification === "diary_summary") {
    if (input.source.kind !== "agent_report") {
      return createRejectedCandidate({ input, classification: "unverified_summary", content: "[REDACTED unverified_summary]" })
    }
    if (input.content.length > 1024) {
      return createRejectedCandidate({ input, classification: "large_prompt_dump", content: "[REDACTED large_prompt_dump]" })
    }
    return createAcceptedCandidate({ input, classification: "diary_summary", requiresUserApproval: false })
  }

  if (input.classification === "temporal_fact") {
    if (input.source.kind !== "durable_memory") {
      return createRejectedCandidate({ input, classification: "unverified_summary", content: "[REDACTED unverified_summary]" })
    }
    return createAcceptedCandidate({ input, classification: "temporal_fact", requiresUserApproval: false })
  }

  if (input.classification === "subjective_or_personal") {
    return createAcceptedCandidate({ input, classification: "subjective_or_personal", requiresUserApproval: true })
  }

  if (input.classification === "objective_fact" || input.classification === "decision") {
    if (input.source.kind === "agent_report" || input.source.kind === "active_user_prompt") {
      return createRejectedCandidate({ input, classification: "unverified_summary", content: "[REDACTED unverified_summary]" })
    }
    return createAcceptedCandidate({ input, classification: input.classification, requiresUserApproval: false })
  }

  if (input.classification === "preference") {
    if (input.source.kind === "agent_report") {
      return createRejectedCandidate({ input, classification: "unverified_summary", content: "[REDACTED unverified_summary]" })
    }
    return createAcceptedCandidate({ input, classification: "preference", requiresUserApproval: false })
  }

  return createRejectedCandidate({ input, classification: "unverified_summary", content: "[REDACTED unverified_summary]" })
}
