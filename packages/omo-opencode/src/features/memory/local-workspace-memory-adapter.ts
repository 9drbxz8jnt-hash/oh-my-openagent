import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"

import type { MemoryConfig } from "../../config/schema/memory-config"
import type {
  DurableMemoryCandidate,
  MemoryReadQuery,
  MemoryReadResult,
  MemoryWriteResult,
} from "./contracts"
import { readLocalWorkspaceRecords } from "./local-workspace-notes"
import {
  ACTIVE_NOTEBOOK_ROOT,
  LOCAL_WORKSPACE_ADAPTER_ID,
  LOCAL_WRITE_CONTENT_LIMIT,
  createAvailableReadResult,
  createMemorySource,
  createUnavailableResult,
  truncateContent,
} from "./memory-adapter-shared"

export interface LocalWorkspaceMemoryAdapter {
  readonly id: string
  read(query: MemoryReadQuery): Promise<MemoryReadResult>
  write(candidate: DurableMemoryCandidate): Promise<MemoryWriteResult>
}

function looksLikeRawLogBlob(content: string): boolean {
  const markers = [/^Command:/m, /^Output:/m, /\b\d+\s+pass\b/i, /\b\d+\s+fail\b/i, /\bexit\s+\d+\b/i]
  const nonEmptyLineCount = content.split(/\r?\n/).filter((line) => line.trim().length > 0).length
  return nonEmptyLineCount >= 3 && markers.filter((marker) => marker.test(content)).length >= 2
}

async function writeToLocalWorkspace(workspaceRoot: string, candidate: DurableMemoryCandidate): Promise<MemoryWriteResult> {
  if (candidate.classification === "subjective_or_personal") {
    return { status: "needs_user_approval", candidateId: candidate.id, reason: "subjective_or_personal" }
  }
  if (candidate.content.length > LOCAL_WRITE_CONTENT_LIMIT || looksLikeRawLogBlob(candidate.content)) {
    return {
      status: "rejected",
      candidateId: candidate.id,
      reason: candidate.content.length > LOCAL_WRITE_CONTENT_LIMIT ? "content_too_large" : "raw_log_blob",
    }
  }

  const targetFileName = candidate.classification === "decision" ? "decisions.md" : "learnings.md"
  const targetDirectory = path.join(workspaceRoot, ACTIVE_NOTEBOOK_ROOT)
  const targetPath = path.join(targetDirectory, targetFileName)
  const timestamp = new Date().toISOString()
  const sourceLabel = candidate.source.reference ?? candidate.source.label
  const entry = [`## ${timestamp}`, `- [${candidate.id}] ${truncateContent(candidate.content, LOCAL_WRITE_CONTENT_LIMIT)} (source: ${sourceLabel})`, ""].join("\n")

  await mkdir(targetDirectory, { recursive: true })
  await appendFile(targetPath, `${entry}\n`)

  return { status: "written", adapterId: LOCAL_WORKSPACE_ADAPTER_ID, candidateId: candidate.id, source: candidate.source }
}

export function createLocalWorkspaceMemoryAdapter(args: {
  readonly workspaceRoot: string
  readonly memory: MemoryConfig
}): LocalWorkspaceMemoryAdapter {
  const workspaceRoot = path.resolve(args.workspaceRoot)
  return {
    id: LOCAL_WORKSPACE_ADAPTER_ID,
    async read(query: MemoryReadQuery): Promise<MemoryReadResult> {
      if (!args.memory.enabled || !args.memory.local_workspace.enabled) {
        return createUnavailableResult({
          adapterId: LOCAL_WORKSPACE_ADAPTER_ID,
          reason: "disabled",
          message: "Local workspace memory is disabled in config",
          source: createMemorySource("local_workspace", "workspace .omo notepads", ACTIVE_NOTEBOOK_ROOT),
        })
      }
      if (query.sources?.includes("local_workspace") === false) {
        return createUnavailableResult({
          adapterId: LOCAL_WORKSPACE_ADAPTER_ID,
          reason: "out_of_scope",
          message: "Local workspace memory is outside the requested source scope",
          source: createMemorySource("local_workspace", "workspace .omo notepads", ACTIVE_NOTEBOOK_ROOT),
        })
      }

      const records = await readLocalWorkspaceRecords(workspaceRoot, query)
      return createAvailableReadResult({
        adapterId: LOCAL_WORKSPACE_ADAPTER_ID,
        source: createMemorySource("local_workspace", "workspace .omo notepads", ACTIVE_NOTEBOOK_ROOT),
        records,
      })
    },
    async write(candidate: DurableMemoryCandidate): Promise<MemoryWriteResult> {
      if (!args.memory.enabled || !args.memory.local_workspace.enabled) {
        return { status: "skipped", candidateId: candidate.id, reason: "disabled" }
      }
      return await writeToLocalWorkspace(workspaceRoot, candidate)
    },
  }
}
