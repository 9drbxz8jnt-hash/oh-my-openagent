/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { MemoryConfigSchema } from "../../config/schema/memory-config"
import { classifyMemoryCandidate, type DurableMemoryCandidate } from "./contracts"
import { createMemoryAdapters, type MemPalaceMcpClient } from "./memory-adapters"

async function createWorkspaceFixture(name: string): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), `omo-memory-${name}-`))
  await mkdir(path.join(workspaceRoot, ".omo/notepads/runtime-hooks-agent-memory-architecture"), { recursive: true })
  await mkdir(path.join(workspaceRoot, ".omo/evidence"), { recursive: true })

  await writeFile(
    path.join(workspaceRoot, ".omo/notepads/runtime-hooks-agent-memory-architecture/learnings.md"),
    [
      "# Runtime Hooks Memory Learnings",
      "- workspace memory stays local and bounded",
      "- MemPalace remains optional and timeout-bound",
      "- raw evidence blobs stay out of memory",
      "",
    ].join("\n"),
  )

  await writeFile(
    path.join(workspaceRoot, ".omo/evidence/task-6-mempalace-fallback.txt"),
    ["Command:", "bun test packages/omo-opencode/src/features/memory/*adapter*.test.ts", "Output:", "SECRET_SENTINEL raw evidence blob", "4 pass 0 fail", ""].join("\n"),
  )

  return workspaceRoot
}

function createUnavailableClient(): MemPalaceMcpClient {
  return {
    status: async () => {
      throw new Error("mempalace_status: ECONNREFUSED")
    },
    search: async () => {
      throw new Error("mempalace_search should not be reached when status is unavailable")
    },
    kgQuery: async () => {
      throw new Error("mempalace_kg_query should not be reached when status is unavailable")
    },
  }
}

function createTimedOutClient(): MemPalaceMcpClient {
  return {
    status: async () => await new Promise<never>(() => undefined),
    search: async () => {
      throw new Error("mempalace_search should not be reached when probe times out")
    },
    kgQuery: async () => {
      throw new Error("mempalace_kg_query should not be reached when probe times out")
    },
  }
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

describe("MemPalace memory adapter fallback", () => {
  test("#given MemPalace offline #when read #then typed unavailable result falls back to local workspace", async () => {
    const workspaceRoot = await createWorkspaceFixture("unavailable")
    const adapters = createMemoryAdapters({
      workspaceRoot,
      memory: MemoryConfigSchema.parse({
        enabled: true,
        local_workspace: { enabled: true },
        mempalace: { enabled: true, timeout_ms: 50, mode: "optional" },
      }),
      mempalaceClient: createUnavailableClient(),
    })

    const probe = await adapters.mempalace.probe({ query: "workspace" })
    expect(probe.status).toBe("unavailable")
    if (probe.status !== "unavailable") throw new Error(`Expected unavailable probe, got ${probe.status}`)
    expect(probe.reason).toBe("client_unavailable")

    const result = await adapters.read({ query: "workspace", limit: 5 })
    expect(result.status).toBe("available")
    if (result.status !== "available") throw new Error(`Expected available fallback result, got ${result.status}`)
    expect(result.adapterId).toBe("local_workspace")
    expect(result.fallback?.status).toBe("unavailable")
    expect(result.fallback?.adapterId).toBe("mempalace")
    expect(result.records.length).toBeGreaterThan(0)
    expect(result.records.some((record) => record.content.includes("SECRET_SENTINEL"))).toBe(false)
    expect(result.records.find((record) => record.content.includes("workspace memory stays local and bounded"))?.source.reference).toBe(
      ".omo/notepads/runtime-hooks-agent-memory-architecture/learnings.md#L2",
    )
  })

  test("#given MemPalace timeout #when read #then timeout is typed and local fallback continues", async () => {
    const workspaceRoot = await createWorkspaceFixture("timeout")
    const adapters = createMemoryAdapters({
      workspaceRoot,
      memory: MemoryConfigSchema.parse({
        enabled: true,
        local_workspace: { enabled: true },
        mempalace: { enabled: true, timeout_ms: 25, mode: "optional" },
      }),
      mempalaceClient: createTimedOutClient(),
    })

    const startedAt = Date.now()
    const probe = await adapters.mempalace.probe({ query: "workspace" })
    const elapsed = Date.now() - startedAt
    expect(elapsed).toBeLessThan(1000)
    expect(probe.status).toBe("timeout")
    if (probe.status !== "timeout") throw new Error(`Expected timeout probe, got ${probe.status}`)
    expect(probe.timeoutMs).toBe(25)

    const result = await adapters.read({ query: "workspace", limit: 5 })
    expect(result.status).toBe("available")
    if (result.status !== "available") throw new Error(`Expected available fallback result, got ${result.status}`)
    expect(result.adapterId).toBe("local_workspace")
    expect(result.fallback?.status).toBe("timeout")
    expect(result.fallback?.adapterId).toBe("mempalace")
  })

  test("#given governance not injected #when MemPalace write runs #then write is skipped", async () => {
    const workspaceRoot = await createWorkspaceFixture("write-skip")
    const adapters = createMemoryAdapters({
      workspaceRoot,
      memory: MemoryConfigSchema.parse({
        enabled: true,
        local_workspace: { enabled: true },
        mempalace: { enabled: true, timeout_ms: 50, mode: "optional" },
      }),
      mempalaceClient: createUnavailableClient(),
    })

    const candidate = createObjectiveFactCandidate()
    await expect(adapters.mempalace.write(candidate)).resolves.toEqual({
      status: "skipped",
      candidateId: candidate.id,
      reason: "write_unavailable",
    })
  })

  test("#given global memory disabled #when adapters run #then disabled results are returned", async () => {
    const workspaceRoot = await createWorkspaceFixture("globally-disabled")
    const adapters = createMemoryAdapters({
      workspaceRoot,
      memory: MemoryConfigSchema.parse({
        enabled: false,
        local_workspace: { enabled: false },
        mempalace: { enabled: true, timeout_ms: 50, mode: "optional" },
      }),
      mempalaceClient: createUnavailableClient(),
    })
    const candidate = createObjectiveFactCandidate()

    const probe = await adapters.mempalace.probe({ query: "workspace" })
    const readResult = await adapters.mempalace.read({ query: "workspace", limit: 5 })
    const combinedDecision = await adapters.write(candidate)
    const directDecision = await adapters.mempalace.write(candidate)

    expect(probe.status).toBe("unavailable")
    if (probe.status !== "unavailable") throw new Error(`Expected unavailable probe, got ${probe.status}`)
    expect(probe.reason).toBe("disabled")
    expect(readResult.status).toBe("unavailable")
    if (readResult.status !== "unavailable") throw new Error(`Expected unavailable read result, got ${readResult.status}`)
    expect(readResult.reason).toBe("disabled")
    expect(combinedDecision).toEqual({ status: "skipped", candidateId: candidate.id, reason: "disabled" })
    expect(directDecision).toEqual({ status: "skipped", candidateId: candidate.id, reason: "disabled" })
  })
})
