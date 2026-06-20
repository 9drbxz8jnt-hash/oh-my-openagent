/// <reference path="../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

const readProjectFile = (path: string) => readFile(join(process.cwd(), path), "utf8")

describe("runtime architecture docs", () => {
  test("#given README #when compatibility names are documented #then the central matrix covers current aliases", async () => {
    // given
    const readme = await readProjectFile("README.md")

    // then
    expect(readme).toContain("### Compatibility matrix")
    for (const expected of [
      "`oh-my-openagent`",
      "`oh-my-opencode`",
      "`omo`",
      "`lazycodex-ai`",
      "`lazycodex`",
      "`sisyphuslabs/omo` and `omo@sisyphuslabs`",
      "`oh-my-openagent.json[c]`",
      "`oh-my-opencode.json[c]`",
      "`orchestrator-sisyphus`, display variant `Atlas`, and hook `sisyphus-orchestrator`",
      "These map to `atlas`",
      "Atlas remains supported in this release",
    ]) {
      expect(readme).toContain(expected)
    }
  })

  test("#given configuration reference #when runtime supervisor compatibility is documented #then it uses the real rollback flag", async () => {
    // given
    const configuration = await readProjectFile("docs/reference/configuration.md")

    // then
    expect(configuration).toContain("experimental.disable_live_parent_wake_routing")
    expect(configuration).toContain("disables live parent-wake routing")
    expect(configuration).toContain("in-process route fallback")
    expect(configuration).not.toContain("sisyphus.supervisor_mode")
  })

  test("#given configuration reference #when memory policy is documented #then evidence and durable memory ownership are explicit", async () => {
    // given
    const configuration = await readProjectFile("docs/reference/configuration.md")

    // then
    for (const expected of [
      "MemPalace is optional fallback memory",
      "local `.omo` state as the execution and evidence source of truth",
      "Parent sessions and Sisyphus own durable memory decisions",
      "Subagents should return memory candidates to the parent",
      "`.omo/evidence/<date-slug>/`",
      "hot path is bounded",
    ]) {
      expect(configuration).toContain(expected)
    }
  })

  test("#given CLI reference #when Codex Light runtime commands are documented #then real sparkshell and ulw-loop surfaces are present", async () => {
    // given
    const cli = await readProjectFile("docs/reference/cli.md")

    // then
    for (const expected of [
      "`sparkshell [args...]`",
      "`ulw-loop [args...]`",
      "omo sparkshell <command> [args...]",
      "omo sparkshell [--json] [--budget <chars>] <command> [args...]",
      "omo sparkshell --shell '<shell command>'",
      "omo sparkshell --tmux-pane <pane-id> [--tail-lines <100-1000>]",
      "omo ulw-loop [args...]",
      "Codex ulw-loop is not installed. Run: npx lazycodex-ai@latest install --no-tui",
    ]) {
      expect(cli).toContain(expected)
    }
  })
})
