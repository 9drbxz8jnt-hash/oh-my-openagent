import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { PLUGIN_NAME } from "../../shared"
import { resolveFilePluginCompiledEntry } from "./resolve-file-plugin-compiled-entry"

const tempDirs: string[] = []

function tempPackageDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-file-plugin-entry-"))
  tempDirs.push(dir)
  return dir
}

function writePackageJson(dir: string, value: unknown): void {
  writeFileSync(join(dir, "package.json"), JSON.stringify(value, null, 2) + "\n", "utf-8")
}

function writeFileFromPackageRoot(dir: string, relativePath: string, contents: string): void {
  const filePath = join(dir, relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, contents, "utf-8")
}

function writeCompiledFile(dir: string, relativePath: string): void {
  writeFileFromPackageRoot(dir, relativePath, "export default {}\n")
}

function fileEntry(dir: string): string {
  return `file:${dir}`
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("resolveFilePluginCompiledEntry", () => {
  it("#given exports dot string points at existing js #when resolving file entry #then it returns non-null", () => {
    // given
    const dir = tempPackageDir()
    writePackageJson(dir, { name: PLUGIN_NAME, exports: { ".": "./dist/index.js" } })
    writeCompiledFile(dir, "./dist/index.js")

    // when
    const result = resolveFilePluginCompiledEntry(fileEntry(dir))

    // then
    expect(result).not.toBeNull()
  })

  it("#given exports dot import condition points at existing js #when resolving file entry #then it returns non-null", () => {
    // given
    const dir = tempPackageDir()
    writePackageJson(dir, { name: PLUGIN_NAME, exports: { ".": { import: "./dist/import.js" } } })
    writeCompiledFile(dir, "./dist/import.js")

    // when
    const result = resolveFilePluginCompiledEntry(fileEntry(dir))

    // then
    expect(result).not.toBeNull()
  })

  it("#given exports dot node condition points at existing js #when resolving file entry #then it returns non-null", () => {
    // given
    const dir = tempPackageDir()
    writePackageJson(dir, { name: PLUGIN_NAME, exports: { ".": { node: "./dist/node.js" } } })
    writeCompiledFile(dir, "./dist/node.js")

    // when
    const result = resolveFilePluginCompiledEntry(fileEntry(dir))

    // then
    expect(result).not.toBeNull()
  })

  it("#given exports dot default condition points at existing js #when resolving file entry #then it returns non-null", () => {
    // given
    const dir = tempPackageDir()
    writePackageJson(dir, { name: PLUGIN_NAME, exports: { ".": { default: "./dist/default.js" } } })
    writeCompiledFile(dir, "./dist/default.js")

    // when
    const result = resolveFilePluginCompiledEntry(fileEntry(dir))

    // then
    expect(result).not.toBeNull()
  })

  it("#given main points at existing mjs #when resolving file entry #then it returns non-null", () => {
    // given
    const dir = tempPackageDir()
    writePackageJson(dir, { name: PLUGIN_NAME, main: "./dist/index.mjs" })
    writeCompiledFile(dir, "./dist/index.mjs")

    // when
    const result = resolveFilePluginCompiledEntry(fileEntry(dir))

    // then
    expect(result).not.toBeNull()
  })

  it("#given main points at existing cjs #when resolving file entry #then it returns non-null", () => {
    // given
    const dir = tempPackageDir()
    writePackageJson(dir, { name: PLUGIN_NAME, main: "./dist/index.cjs" })
    writeCompiledFile(dir, "./dist/index.cjs")

    // when
    const result = resolveFilePluginCompiledEntry(fileEntry(dir))

    // then
    expect(result).not.toBeNull()
  })

  it("#given default index js exists #when resolving file entry #then it returns non-null", () => {
    // given
    const dir = tempPackageDir()
    writePackageJson(dir, { name: PLUGIN_NAME })
    writeCompiledFile(dir, "index.js")

    // when
    const result = resolveFilePluginCompiledEntry(fileEntry(dir))

    // then
    expect(result).not.toBeNull()
  })

  it("#given exports dot points at ts source #when resolving file entry #then it returns null", () => {
    // given
    const dir = tempPackageDir()
    writePackageJson(dir, { name: PLUGIN_NAME, exports: { ".": "./src/index.ts" } })
    writeFileFromPackageRoot(dir, "./src/index.ts", "export default {}\n")

    // when
    const result = resolveFilePluginCompiledEntry(fileEntry(dir))

    // then
    expect(result).toBeNull()
  })

  it("#given exports dot points at missing dist js #when resolving file entry #then it returns null", () => {
    // given
    const dir = tempPackageDir()
    writePackageJson(dir, { name: PLUGIN_NAME, exports: { ".": "./dist/index.js" } })

    // when
    const result = resolveFilePluginCompiledEntry(fileEntry(dir))

    // then
    expect(result).toBeNull()
  })

  it("#given invalid package json #when resolving file entry #then it returns null", () => {
    // given
    const dir = tempPackageDir()
    writeFileSync(join(dir, "package.json"), "{bad json", "utf-8")

    // when
    const result = resolveFilePluginCompiledEntry(fileEntry(dir))

    // then
    expect(result).toBeNull()
  })

  it("#given package json is missing #when resolving file entry #then it returns null", () => {
    // given
    const dir = tempPackageDir()

    // when
    const result = resolveFilePluginCompiledEntry(fileEntry(dir))

    // then
    expect(result).toBeNull()
  })

  it("#given entry is not file protocol #when resolving file entry #then it returns null", () => {
    // given
    const namedEntry = PLUGIN_NAME
    const httpEntry = "https://example.test/plugin"

    // when
    const namedResult = resolveFilePluginCompiledEntry(namedEntry)
    const httpResult = resolveFilePluginCompiledEntry(httpEntry)

    // then
    expect(namedResult).toBeNull()
    expect(httpResult).toBeNull()
  })
})
