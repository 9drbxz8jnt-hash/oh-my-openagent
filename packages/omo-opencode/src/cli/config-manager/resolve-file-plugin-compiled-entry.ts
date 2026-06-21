import { existsSync, readFileSync } from "node:fs"
import { extname, join } from "node:path"

const COMPILED_ENTRY_EXTENSIONS = new Set([".js", ".mjs", ".cjs"])
const EXPORT_CONDITION_ORDER = ["import", "node", "default"] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function fileEntryPackageDir(fileEntry: string): string | null {
  if (!fileEntry.startsWith("file:")) return null
  return fileEntry.slice("file:".length).replace(/^\/\//, "")
}

function readPackageJson(packageJsonPath: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf-8"))
    return isRecord(parsed) ? parsed : null
  } catch (error) {
    if (!(error instanceof Error)) throw error
  }
  return null
}

function resolveExportsDotTarget(exportsValue: unknown): string | null {
  if (!isRecord(exportsValue)) return null

  const dotExport = exportsValue["."]
  if (typeof dotExport === "string") return dotExport
  if (!isRecord(dotExport)) return null

  for (const condition of EXPORT_CONDITION_ORDER) {
    const conditionTarget = dotExport[condition]
    if (typeof conditionTarget === "string") return conditionTarget
  }
  return null
}

function packageEntryTarget(packageJson: Record<string, unknown>): string {
  const exportsTarget = resolveExportsDotTarget(packageJson.exports)
  if (exportsTarget) return exportsTarget
  return typeof packageJson.main === "string" ? packageJson.main : "index.js"
}

export function resolveFilePluginCompiledEntry(fileEntry: string): string | null {
  const packageDir = fileEntryPackageDir(fileEntry)
  if (!packageDir) return null

  const packageJson = readPackageJson(join(packageDir, "package.json"))
  if (!packageJson) return null

  const entryPath = join(packageDir, packageEntryTarget(packageJson))
  if (!COMPILED_ENTRY_EXTENSIONS.has(extname(entryPath))) return null
  return existsSync(entryPath) ? entryPath : null
}
