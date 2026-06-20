import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { RUNTIME_HOOK_CONTRACT, type RuntimeHookViolation } from "./runtime-hook-contract"

const WORKSPACE_ROOT = findWorkspaceRoot(import.meta.dir)
const WRITE_TOKENS = ["write", "save", "add", "upsert", "store", "append", "persist", "record", "insert", "set"] as const
const MEMORY_TOKENS = ["mempalace", "memory", "drawer", "fact", "adapter", "palace"] as const

function findWorkspaceRoot(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(path.join(dir, "bun.lock")) || existsSync(path.join(dir, ".git"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error("repo root sentinel not found")
    dir = parent
  }
}

function listSourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return []

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return listSourceFiles(entryPath)
    if (!entry.isFile()) return []
    if (!entry.name.endsWith(".ts")) return []
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".d.ts")) return []
    return [entryPath]
  })
}

function listWorkspaceSourceFiles(): string[] {
  return listSourceFiles(path.join(WORKSPACE_ROOT, "packages"))
}

function relativeWorkspacePath(filePath: string): string {
  if (!path.isAbsolute(filePath)) return path.normalize(filePath).split(path.sep).join("/")
  return path.relative(WORKSPACE_ROOT, filePath).split(path.sep).join("/")
}

function splitIdentifierTokens(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase())
}

function hasMemoryImport(sourceText: string): boolean {
  return /from\s+["'][^"']*(?:mempalace|memory[-_/]?adapter|external[-_/]?memory)[^"']*["']/i.test(sourceText)
}

function hasMemoryWrite(sourceText: string): boolean {
  const callMatches = sourceText.matchAll(/([A-Za-z0-9_$.[\]"']+)\s*\.\s*([A-Za-z0-9_$]+)\s*\(/g)
  for (const match of callMatches) {
    const receiverTokens = splitIdentifierTokens(match[1] ?? "")
    const methodTokens = splitIdentifierTokens(match[2] ?? "")
    if (receiverTokens.some((token) => MEMORY_TOKENS.includes(token)) && methodTokens.some((token) => WRITE_TOKENS.includes(token))) {
      return true
    }
  }

  const functionMatches = sourceText.matchAll(/\b([A-Za-z0-9_$]+)\s*\(/g)
  for (const match of functionMatches) {
    const tokens = splitIdentifierTokens(match[1] ?? "")
    if (tokens.some((token) => MEMORY_TOKENS.includes(token)) && tokens.some((token) => WRITE_TOKENS.includes(token))) {
      return true
    }
  }

  return false
}

function isRestrictedRuntimeHookSource(filePath: string, sourceText: string): boolean {
  const relativePath = relativeWorkspacePath(filePath)
  if (RUNTIME_HOOK_CONTRACT.restrictedPaths.some((rule) => rule.path === relativePath)) return true

  return RUNTIME_HOOK_CONTRACT.restrictedPaths.some((rule) =>
    rule.signals.some((signal) => sourceText.includes(signal)))
}

function firstMatchingLine(sourceText: string, matcher: (line: string) => boolean): number {
  const lines = sourceText.split("\n")
  const index = lines.findIndex(matcher)
  return index === -1 ? 1 : index + 1
}

function findRestrictedPathMemoryViolations(args: {
  filePath: string
  sourceText: string
}): RuntimeHookViolation[] {
  const { filePath, sourceText } = args
  if (!isRestrictedRuntimeHookSource(filePath, sourceText)) return []

  const violations: RuntimeHookViolation[] = []
  const hasExternalMemoryImport = hasMemoryImport(sourceText)
  if (hasExternalMemoryImport) {
    violations.push({
      kind: "memory-import",
      filePath,
      line: firstMatchingLine(sourceText, (line) => /from\s+["'][^"']*(?:mempalace|memory[-_/]?adapter|external[-_/]?memory)[^"']*["']/i.test(line)),
    })
  }

  if (hasExternalMemoryImport && hasMemoryWrite(sourceText)) {
    violations.push({
      kind: "memory-write",
      filePath,
      line: firstMatchingLine(sourceText, (line) => /(?:write|save|add|upsert|store|append|persist|record|insert|set)[A-Za-z0-9_$]*\s*\(/i.test(line)),
    })
  }

  return violations
}

describe("runtime hook contract", () => {
  test("#given the manifest #when inspected #then current hook tiers are classified", () => {
    expect(RUNTIME_HOOK_CONTRACT.tiers.map((tier) => tier.name)).toEqual([
      "Session Hooks",
      "Tool Guard Hooks",
      "Transform Hooks",
      "Continuation Hooks",
      "Skill Hooks",
      "Direct Event Handlers",
    ])

    expect(RUNTIME_HOOK_CONTRACT.tiers.map((tier) => tier.hookCount)).toEqual([24, 18, 7, 7, 2, 4])
    expect(RUNTIME_HOOK_CONTRACT.surfacePolicy.hot.memoryPolicy).toBe("forbidden")
    expect(RUNTIME_HOOK_CONTRACT.surfacePolicy.warm.memoryPolicy).toBe("forbidden")
    expect(RUNTIME_HOOK_CONTRACT.surfacePolicy.bounded.memoryPolicy).toBe("read-only")
    expect(RUNTIME_HOOK_CONTRACT.surfacePolicy["cold-safe"].memoryPolicy).toBe("read-write")
  })

  test("#given the manifest file #when inspected #then it has no TypeScript compiler runtime import", () => {
    const contractFile = readFileSync(path.join(WORKSPACE_ROOT, "packages", "omo-opencode", "src", "hooks", "runtime-hook-contract.ts"), "utf8")

    expect(contractFile.includes('from "typescript"')).toBe(false)
    expect(contractFile.includes("import ts from")).toBe(false)
  })

  test("#given fake restricted hook source #when audited #then memory imports and writes are reported", () => {
    const filePath = "packages/omo-opencode/src/plugin/tool-execute-before.ts"
    const sourceText = [
      'import { createMemPalaceAdapter } from "@omo/mempalace"',
      "",
      "const memoryAdapter = createMemPalaceAdapter()",
      "",
      "export function decorateThing() {",
      "  return async () => {",
      '    await memoryAdapter.writeDrawer("session-123", "hot-path note")',
      "  }",
      "}",
    ].join("\n")

    expect(findRestrictedPathMemoryViolations({ filePath, sourceText })).toEqual([
      { kind: "memory-import", filePath, line: 1 },
      { kind: "memory-write", filePath, line: 7 },
    ])
  })

  test("#given production sources #when restricted runtime paths are audited #then external memory writes stay out", () => {
    const offenders: string[] = []

    for (const filePath of listWorkspaceSourceFiles()) {
      const sourceText = readFileSync(filePath, "utf8")
      const violations = findRestrictedPathMemoryViolations({
        filePath: relativeWorkspacePath(filePath),
        sourceText,
      })

      for (const violation of violations) {
        offenders.push(`${violation.filePath}:${violation.line}:${violation.kind}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
