/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { MemoryConfigSchema } from "../../config/schema/memory-config"
import { classifyMemoryCandidate, type DurableMemoryCandidate } from "./contracts"
import { createLocalWorkspaceMemoryAdapter } from "./local-workspace-memory-adapter"

async function createWorkspaceFixture(name: string): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), `omo-local-memory-${name}-`))
  await mkdir(path.join(workspaceRoot, ".omo/notepads/runtime-hooks-agent-memory-architecture"), { recursive: true })
  await mkdir(path.join(workspaceRoot, ".omo/evidence"), { recursive: true })

  await writeFile(
    path.join(workspaceRoot, ".omo/notepads/runtime-hooks-agent-memory-architecture/learnings.md"),
    [
      "# Runtime Hooks Memory Learnings",
      "- workspace memory stays local and bounded",
      "- the adapter reads curated .omo notes only",
      "- raw evidence blobs stay out of memory",
      "",
    ].join("\n"),
  )

  await writeFile(
    path.join(workspaceRoot, ".omo/evidence/task-6-mempalace-fallback.txt"),
    [
      "Command:",
      "bun test packages/omo-opencode/src/features/memory/*adapter*.test.ts",
      "Output:",
      "SECRET_SENTINEL raw evidence blob",
      "4 pass 0 fail",
      "",
    ].join("\n"),
  )

  return workspaceRoot
}

function createObjectiveFactCandidate(): DurableMemoryCandidate {
  const classified = classifyMemoryCandidate({
    id: "candidate-local-write",
    content: "Task 6 local workspace adapter appends curated notes without raw log blobs.",
    classification: "objective_fact",
    source: {
      kind: "local_workspace",
      label: ".omo/notepads/runtime-hooks-agent-memory-architecture/learnings.md",
      reference: ".omo/notepads/runtime-hooks-agent-memory-architecture/learnings.md",
    },
  })

  if (classified.status !== "accepted") throw new Error(`Expected accepted candidate, got ${classified.status}`)
  return classified
}

describe("local workspace memory adapter", () => {
  test("#given curated notepad and raw evidence files #when read #then only bounded curated notes are returned", async () => {
    const workspaceRoot = await createWorkspaceFixture("read")
    const adapter = createLocalWorkspaceMemoryAdapter({
      workspaceRoot,
      memory: MemoryConfigSchema.parse({
        enabled: true,
        local_workspace: { enabled: true },
        mempalace: { enabled: false, timeout_ms: 200, mode: "optional" },
      }),
    })

    const result = await adapter.read({ query: "workspace", limit: 5 })

    expect(result.status).toBe("available")
    if (result.status !== "available") throw new Error(`Expected available local read result, got ${result.status}`)
    expect(result.adapterId).toBe("local_workspace")
    expect(result.records.length).toBeGreaterThan(0)
    expect(result.records.length).toBeLessThanOrEqual(5)
    expect(result.records.every((record) => record.source.kind === "local_workspace")).toBe(true)
    expect(result.records.every((record) => record.source.label === ".omo/notepads/runtime-hooks-agent-memory-architecture/learnings.md")).toBe(true)
    expect(result.records.every((record) => record.source.reference?.startsWith(".omo/notepads/runtime-hooks-agent-memory-architecture/learnings.md#"))).toBe(true)
    expect(result.records.some((record) => record.content.includes("SECRET_SENTINEL"))).toBe(false)
    expect(result.records.some((record) => record.content.includes("raw evidence blob"))).toBe(false)
    expect(Math.max(...result.records.map((record) => record.content.length))).toBeLessThanOrEqual(300)
    expect(
      result.records.find((record) => record.content.includes("workspace memory stays local and bounded"))?.source.reference,
    ).toBe(".omo/notepads/runtime-hooks-agent-memory-architecture/learnings.md#L2")
  })

  test("#given a durable candidate #when written locally #then it is appended to curated workspace notes", async () => {
    const workspaceRoot = await createWorkspaceFixture("write")
    const adapter = createLocalWorkspaceMemoryAdapter({
      workspaceRoot,
      memory: MemoryConfigSchema.parse({
        enabled: true,
        local_workspace: { enabled: true },
        mempalace: { enabled: false, timeout_ms: 200, mode: "optional" },
      }),
    })

    const candidate = createObjectiveFactCandidate()
    const decision = await adapter.write(candidate)

    expect(decision.status).toBe("written")
    if (decision.status !== "written") throw new Error(`Expected written local decision, got ${decision.status}`)

    const result = await adapter.read({ query: "curated notes", limit: 5 })
    expect(result.status).toBe("available")
    if (result.status !== "available") throw new Error(`Expected available local read result, got ${result.status}`)
    expect(result.records.some((record) => record.content.includes(candidate.content))).toBe(true)

    const learnings = await readFile(
      path.join(workspaceRoot, ".omo/notepads/runtime-hooks-agent-memory-architecture/learnings.md"),
      "utf8",
    )
    expect(learnings).toContain(candidate.content)
  })

  test("#given memory disabled #when local read and write run #then no workspace file is changed", async () => {
    const workspaceRoot = await createWorkspaceFixture("disabled")
    const adapter = createLocalWorkspaceMemoryAdapter({
      workspaceRoot,
      memory: MemoryConfigSchema.parse({
        enabled: false,
        local_workspace: { enabled: true },
        mempalace: { enabled: false, timeout_ms: 200, mode: "optional" },
      }),
    })
    const candidate = createObjectiveFactCandidate()

    const readResult = await adapter.read({ query: "workspace", limit: 5 })
    const writeResult = await adapter.write(candidate)

    expect(readResult.status).toBe("unavailable")
    if (readResult.status !== "unavailable") throw new Error(`Expected unavailable local read result, got ${readResult.status}`)
    expect(readResult.reason).toBe("disabled")
    expect(writeResult).toEqual({ status: "skipped", candidateId: candidate.id, reason: "disabled" })

    const learnings = await readFile(
      path.join(workspaceRoot, ".omo/notepads/runtime-hooks-agent-memory-architecture/learnings.md"),
      "utf8",
    )
    expect(learnings.includes(candidate.content)).toBe(false)
  })
})
