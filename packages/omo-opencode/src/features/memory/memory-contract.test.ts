/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import {
  classifyMemoryCandidate,
  type DurableMemoryCandidate,
  type MemoryConflict,
  type MemoryDecision,
  type MemoryReadAdapter,
  type MemorySource,
  type MemoryWriteAdapter,
} from "./contracts"

describe("memory contracts", () => {
  const workspaceSource: MemorySource = {
    kind: "local_workspace",
    label: ".omo/evidence/task-2-memory-config-defaults.txt",
    reference: ".omo/evidence/task-2-memory-config-defaults.txt",
  }

  test("#given durable objective fact #when classified #then write adapter accepts the stable contract", async () => {
    const classified = classifyMemoryCandidate({
      id: "candidate-objective-fact",
      content: "Task 2 added memory config contracts without hot runtime hook wiring.",
      classification: "objective_fact",
      source: workspaceSource,
    })

    if (classified.status !== "accepted") throw new Error(`Expected accepted candidate, got ${classified.status}`)

    const candidate: DurableMemoryCandidate = classified
    const writeAdapter: MemoryWriteAdapter = {
      id: "local-write-contract",
      write: async (writeCandidate) => ({
        status: "written",
        adapterId: "local-write-contract",
        candidateId: writeCandidate.id,
        source: writeCandidate.source,
      }),
    }
    const readAdapter: MemoryReadAdapter = {
      id: "local-read-contract",
      read: async () => [
        {
          id: "memory-record-1",
          classification: candidate.classification,
          content: candidate.content,
          recordedAt: "2026-06-20T00:00:00.000Z",
          source: candidate.source,
        },
      ],
    }

    const decision = await writeAdapter.write(candidate)
    const records = await readAdapter.read({ query: "memory config schema" })

    expect(decision).toEqual({
      status: "written",
      adapterId: "local-write-contract",
      candidateId: "candidate-objective-fact",
      source: workspaceSource,
    })
    expect(records[0]?.content).toBe(candidate.content)
  })

  test("#given raw command output mislabeled as objective fact #when classified #then it is rejected", () => {
    const classified = classifyMemoryCandidate({
      id: "candidate-mislabeled-raw-log",
      content: [
        "Command:",
        "bun test packages/omo-opencode/src/config/schema/memory-config.test.ts",
        "Output:",
        "1 pass",
        "4 fail",
      ].join("\n"),
      classification: "objective_fact",
      source: workspaceSource,
    })

    expect(classified.status).toBe("rejected")
    if (classified.status !== "rejected") throw new Error(`Expected rejected candidate, got ${classified.status}`)
    expect(classified.classification).toBe("raw_log_blob")
  })

  test("#given secret-like content #when classified #then it is rejected and redacted", () => {
    const classified = classifyMemoryCandidate({
      id: "candidate-secret",
      content: "OPENAI_API_KEY=sk-proj-abc1234567890secretvalue",
      classification: "objective_fact",
      source: workspaceSource,
    })

    expect(classified.status).toBe("rejected")
    if (classified.status !== "rejected") throw new Error(`Expected rejected candidate, got ${classified.status}`)
    expect(classified.reason).toContain("secret_or_credential")
    expect(classified.content).not.toContain("sk-proj-abc1234567890secretvalue")
    expect(classified.content.toLowerCase()).not.toContain("api_key")
  })

  test("#given a conflicting preference #when decision is modeled #then unresolved conflicts require user approval", () => {
    const classified = classifyMemoryCandidate({
      id: "candidate-preference",
      content: "Prefer local workspace evidence over older durable preferences when they conflict.",
      classification: "preference",
      source: workspaceSource,
    })

    if (classified.status !== "accepted") throw new Error(`Expected accepted candidate, got ${classified.status}`)

    const conflict: MemoryConflict = {
      id: "memory-conflict-1",
      candidate: classified,
      existing: [
        {
          id: "memory-record-old",
          classification: "preference",
          content: "Prefer older durable preferences over local execution evidence.",
          recordedAt: "2026-06-01T00:00:00.000Z",
          source: {
            kind: "durable_memory",
            label: "source-backed durable preference",
          },
        },
      ],
      reason: "same_subject_different_value",
    }

    const decision: MemoryDecision = {
      status: "needs_user_approval",
      candidateId: classified.id,
      conflict,
      reason: "conflict",
    }

    expect(decision.status).toBe("needs_user_approval")
    if (decision.status === "needs_user_approval" && decision.reason === "conflict") {
      expect(decision.conflict.reason).toBe("same_subject_different_value")
      expect(decision.conflict.existing[0]?.source.kind).toBe("durable_memory")
    }
  })
})
