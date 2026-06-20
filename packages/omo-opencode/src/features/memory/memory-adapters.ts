import path from "node:path"

import type { MemoryConfig } from "../../config/schema/memory-config"
import type { DurableMemoryCandidate, MemoryReadQuery, MemoryReadResult, MemoryWriteResult } from "./contracts"
import { createLocalWorkspaceMemoryAdapter, type LocalWorkspaceMemoryAdapter } from "./local-workspace-memory-adapter"
import { createMemPalaceMemoryAdapter, type MemPalaceMcpClient, type MemPalaceMemoryAdapter } from "./mempalace-memory-adapter"

export type { MemPalaceMcpClient, MemPalaceMemoryHit } from "./mempalace-memory-adapter"

export interface MemoryAdapters {
  readonly mempalace: MemPalaceMemoryAdapter
  readonly localWorkspace: LocalWorkspaceMemoryAdapter
  read(query: MemoryReadQuery): Promise<MemoryReadResult>
  write(candidate: DurableMemoryCandidate): Promise<MemoryWriteResult>
}

export function createMemoryAdapters(args: {
  readonly workspaceRoot: string
  readonly memory: MemoryConfig
  readonly mempalaceClient: MemPalaceMcpClient
}): MemoryAdapters {
  const workspaceRoot = path.resolve(args.workspaceRoot)
  const mempalace = createMemPalaceMemoryAdapter({ client: args.mempalaceClient, memory: args.memory })
  const localWorkspace = createLocalWorkspaceMemoryAdapter({ workspaceRoot, memory: args.memory })

  return {
    mempalace,
    localWorkspace,
    async read(query: MemoryReadQuery): Promise<MemoryReadResult> {
      const mempalaceResult = await mempalace.read(query)
      if (mempalaceResult.status === "available") return mempalaceResult

      const localResult = await localWorkspace.read(query)
      if (localResult.status === "available") return { ...localResult, fallback: mempalaceResult }

      return mempalaceResult
    },
    async write(candidate: DurableMemoryCandidate): Promise<MemoryWriteResult> {
      if (!args.memory.enabled) return await localWorkspace.write(candidate)
      if (args.memory.local_workspace.enabled) return await localWorkspace.write(candidate)
      return await mempalace.write(candidate)
    },
  }
}
