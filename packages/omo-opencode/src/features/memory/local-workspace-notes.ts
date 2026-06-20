import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

import type { DurableMemoryClassification, MemoryReadQuery, MemoryRecord } from "./contracts"
import {
  ACTIVE_NOTEBOOK_ROOT,
  LOCAL_READ_RECORD_CHAR_LIMIT,
  LOCAL_WORKSPACE_ADAPTER_ID,
  createMemorySource,
  matchesQuery,
  truncateContent,
} from "./memory-adapter-shared"

const CURATED_NOTE_FILES = new Set(["decisions.md", "issues.md", "learnings.md", "problems.md"])
const LOCAL_READ_RECORD_LIMIT = 20

interface CuratedNoteEntry {
  readonly lineNumber: number
  readonly content: string
}

function workspaceRelativePath(workspaceRoot: string, filePath: string): string {
  return path.relative(path.resolve(workspaceRoot), path.resolve(filePath)).split(path.sep).join("/")
}

function isNotepadPathInsideWorkspace(workspaceRoot: string, filePath: string): boolean {
  const relativePath = path.relative(path.resolve(workspaceRoot), path.resolve(filePath))
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
}

async function listCuratedNoteFiles(root: string): Promise<string[]> {
  const discovered: string[] = []

  async function walk(directory: string): Promise<void> {
    try {
      const entries = await readdir(directory, { withFileTypes: true })

      for (const entry of entries.sort((left, right) => String(left.name).localeCompare(String(right.name)))) {
        const entryName = String(entry.name)
        const entryPath = path.join(directory, entryName)
        if (entry.isDirectory()) {
          await walk(entryPath)
          continue
        }

        if (entry.isFile() && CURATED_NOTE_FILES.has(entryName)) discovered.push(entryPath)
      }
    } catch {
      return
    }
  }

  await walk(root)
  return discovered
}

function parseCuratedNoteEntries(fileText: string): CuratedNoteEntry[] {
  const entries: CuratedNoteEntry[] = []
  let inCodeBlock = false
  let currentHeading = ""

  for (const [lineIndex, rawLine] of fileText.split(/\r?\n/).entries()) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue
    if (line.startsWith("#")) {
      currentHeading = line.replace(/^#+\s*/, "").trim()
      continue
    }

    const entry = line.replace(/^[-*•]\s+/, "")
    entries.push({ lineNumber: lineIndex + 1, content: currentHeading ? `${currentHeading} — ${entry}` : entry })
  }

  return entries
}

function inferClassification(fileName: string): DurableMemoryClassification {
  return fileName === "decisions.md" ? "decision" : "objective_fact"
}

function createMemoryRecord(args: {
  readonly workspaceRoot: string
  readonly content: string
  readonly filePath: string
  readonly classification: DurableMemoryClassification
  readonly mtimeMs: number
  readonly lineNumber: number
}): MemoryRecord {
  const relativePath = workspaceRelativePath(args.workspaceRoot, args.filePath)
  const recordedAt = new Date(args.mtimeMs).toISOString()
  return {
    id: `${LOCAL_WORKSPACE_ADAPTER_ID}:${relativePath}:${args.lineNumber}`,
    classification: args.classification,
    content: truncateContent(args.content, LOCAL_READ_RECORD_CHAR_LIMIT),
    recordedAt,
    source: createMemorySource("local_workspace", relativePath, `${relativePath}#L${args.lineNumber}`, recordedAt),
  }
}

export async function readLocalWorkspaceRecords(
  workspaceRoot: string,
  query: MemoryReadQuery,
): Promise<MemoryRecord[]> {
  const notepadRoot = path.join(workspaceRoot, ACTIVE_NOTEBOOK_ROOT)
  const curatedFiles = await listCuratedNoteFiles(notepadRoot)
  const records: MemoryRecord[] = []
  const limit = Math.max(1, Math.min(query.limit ?? 10, LOCAL_READ_RECORD_LIMIT))

  for (const filePath of curatedFiles) {
    if (!isNotepadPathInsideWorkspace(workspaceRoot, filePath)) continue

    let fileStat: Awaited<ReturnType<typeof stat>>
    let fileText = ""
    try {
      fileStat = await stat(filePath)
      fileText = await readFile(filePath, "utf8")
    } catch {
      continue
    }

    const classification = inferClassification(path.basename(filePath))
    for (const entry of parseCuratedNoteEntries(fileText).filter((note) => matchesQuery(note.content, query.query))) {
      records.push(
        createMemoryRecord({
          workspaceRoot,
          content: entry.content,
          filePath,
          classification,
          mtimeMs: fileStat.mtimeMs,
          lineNumber: entry.lineNumber,
        }),
      )
      if (records.length >= limit) return records
    }
  }

  return records
}
