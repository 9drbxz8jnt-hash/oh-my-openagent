import { describe, expect, test } from "bun:test"

import { createExploreAgent } from "./explore"
import { createLibrarianAgent } from "./librarian"
import { createMetisAgent } from "./metis"
import { createMomusAgent } from "./momus"
import { createOracleAgent } from "./oracle"
import { buildSisyphusJuniorPrompt } from "./sisyphus-junior"

const SUBAGENT_PROMPTS = [
  { name: "Explore", prompt: () => createExploreAgent("gpt-5.4-mini").prompt },
  { name: "Librarian", prompt: () => createLibrarianAgent("gpt-5.4-mini").prompt },
  { name: "Oracle", prompt: () => createOracleAgent("gpt-5.5").prompt },
  { name: "Metis", prompt: () => createMetisAgent("claude-sonnet-4-6").prompt },
  { name: "Momus", prompt: () => createMomusAgent("gpt-5.5").prompt },
  { name: "Sisyphus-Junior", prompt: () => buildSisyphusJuniorPrompt("gpt-5.5", false) },
] as const

describe("collaborator agent prompt contracts", () => {
  describe("#given subagent prompts", () => {
    describe("#when checking supervisor memory governance", () => {
      test("#then each subagent returns memory candidates and never writes MemPalace directly", () => {
        for (const { name, prompt } of SUBAGENT_PROMPTS) {
          const text = prompt()

          expect(text, name).toContain("Return durable learnings as memory candidates")
          expect(text, name).toContain("Do not write MemPalace directly")
          expect(text, name).toContain("Sisyphus or the parent supervisor decides what is saved")
        }
      })
    })
  })

  describe("#given research subagent prompts", () => {
    describe("#when checking evidence contracts", () => {
      test("#then Explore and Librarian require source-backed findings", () => {
        expect(createExploreAgent("gpt-5.4-mini").prompt).toContain("Source-backed findings")
        expect(createLibrarianAgent("gpt-5.4-mini").prompt).toContain("Source-backed findings")
      })
    })
  })

  describe("#given advisor prompts", () => {
    describe("#when checking machine-readable outputs", () => {
      test("#then Oracle, Metis, and Momus expose explicit verdict contracts", () => {
        expect(createOracleAgent("gpt-5.5").prompt).toContain("Verdict: GO or NO-GO")
        expect(createMetisAgent("claude-sonnet-4-6").prompt).toContain("Blockers / Guardrails")
        expect(createMomusAgent("gpt-5.5").prompt).toContain("review the plan file only")
      })
    })
  })

  describe("#given prompt snapshots stay lean", () => {
    describe("#when checking collaboration contract scope", () => {
      test("#then prompts do not duplicate the Moe operator guidance block", () => {
        for (const { name, prompt } of SUBAGENT_PROMPTS) {
          const text = prompt()

          expect(text, name).not.toContain("moe-operator-guard")
          expect(text, name).not.toContain("HOW YOU TALK TO HIM")
        }
      })
    })
  })
})
