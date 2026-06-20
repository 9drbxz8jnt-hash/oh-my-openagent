import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { relative, resolve } from "node:path"

type SurfaceCategory =
  | "agent factory"
  | "config override key"
  | "docs/commands/user-facing names"
  | "model requirements"
  | "prompt variants/prompts-core"
  | "tests/snapshots public names"

type InventoryEntry = {
  path: string
  category: SurfaceCategory
  reason: string
  needles: readonly string[]
}

const repoRoot = resolve(import.meta.dir, "../../../..")
const rootPath = (...segments: string[]) => resolve(repoRoot, ...segments)
const relativePath = (path: string) => relative(repoRoot, path).split("\\").join("/")

const PUBLIC_SURFACE_SCOPES = [
  rootPath("docs"),
  rootPath("packages/prompts-core/prompts/atlas"),
  rootPath("packages/omo-opencode/src/agents/AGENTS.md"),
  rootPath("packages/omo-opencode/src/agents/atlas/AGENTS.md"),
  rootPath("packages/omo-opencode/src/agents/atlas/agent.ts"),
  rootPath("packages/omo-opencode/src/agents/builtin-agents.ts"),
  rootPath("packages/omo-opencode/src/agents/builtin-agents/atlas-agent.ts"),
  rootPath("packages/omo-opencode/src/features/builtin-commands/commands.ts"),
  rootPath("packages/omo-opencode/src/features/builtin-commands/templates"),
  rootPath("packages/omo-opencode/src/shared/agent-display-names.ts"),
  rootPath("packages/omo-opencode/src/shared/agent-config-integration.test.ts"),
  rootPath("packages/omo-opencode/src/shared/dist-bundle-prompt-content.test.ts"),
] as const

const inventoryFilePath = rootPath("packages/omo-opencode/src/agents/atlas-public-surface-inventory.test.ts")

const INVENTORY: readonly InventoryEntry[] = [
  { path: rootPath("docs/examples/coding-focused.jsonc"), category: "docs/commands/user-facing names", reason: "Example config keeps the public Atlas override key visible for coding-focused setups.", needles: ['"atlas": {}'] },
  { path: rootPath("docs/examples/default.jsonc"), category: "docs/commands/user-facing names", reason: "Default example config keeps the public Atlas override key visible.", needles: ['"atlas": {}'] },
  { path: rootPath("docs/examples/planning-focused.jsonc"), category: "docs/commands/user-facing names", reason: "Planning-focused example references Atlas as a planner/orchestrator collaborator and config key.", needles: ["Always consult prometheus and atlas", '"atlas": {'] },
  { path: rootPath("docs/guide/agent-model-matching.md"), category: "docs/commands/user-facing names", reason: "User guide explains Atlas model-family prompt behavior and provider fallback positioning.", needles: ["Atlas still supports model-family prompt behavior", "Sisyphus/Atlas"] },
  { path: rootPath("docs/guide/installation.md"), category: "docs/commands/user-facing names", reason: "Install guide lists Atlas recommended/fallback models.", needles: ["| **Atlas**", "Todo orchestrator"] },
  { path: rootPath("docs/guide/orchestration.md"), category: "docs/commands/user-facing names", reason: "Orchestration guide describes Atlas as the plan executor and conductor.", needles: ["Prometheus plans, Atlas executes", "Sisyphus → Hephaestus → Prometheus → Atlas"] },
  { path: rootPath("docs/guide/overview.md"), category: "docs/commands/user-facing names", reason: "Overview guide presents Atlas as the conductor activated by /start-work.", needles: ["### Atlas: The Conductor", "Run `/start-work` to activate Atlas"] },
  { path: rootPath("docs/guide/team-mode.md"), category: "docs/commands/user-facing names", reason: "Team-mode guide lists Atlas as a direct/eligible team member kind.", needles: ['direct agent (atlas', "`sisyphus`, `atlas`, `sisyphus-junior`"] },
  { path: rootPath("docs/reference/configuration.md"), category: "docs/commands/user-facing names", reason: "Configuration reference documents Atlas override keys and core-agent ordering.", needles: ["`momus`, `atlas`, `sisyphus-junior`", '"agent_order": ["hephaestus", "sisyphus", "prometheus", "atlas"]'] },
  { path: rootPath("docs/reference/features.md"), category: "docs/commands/user-facing names", reason: "Feature reference lists Atlas in ordering, model, and tool-restriction surfaces.", needles: ["Atlas", "atlas"] },
  { path: rootPath("docs/reference/known-issues.md"), category: "docs/commands/user-facing names", reason: "Known-issues reference mentions Atlas in user-visible desktop visibility troubleshooting.", needles: ["Sisyphus, Hephaestus, Prometheus, Atlas"] },
  { path: rootPath("docs/runtime-architecture-docs.test.ts"), category: "tests/snapshots public names", reason: "Runtime architecture doc tests lock Atlas compatibility wording and prevent stale supervisor-mode docs from returning.", needles: ["Atlas remains supported in this release", "These map to `atlas`", "sisyphus.supervisor_mode"] },
  { path: rootPath("packages/omo-opencode/src/agents/builtin-agents.ts"), category: "agent factory", reason: "Registers the Atlas factory and prompt metadata in the built-in agent registry.", needles: ["atlas: createAtlasAgent as AgentFactory", "atlas: atlasPromptMetadata", 'buildAvailableSkills(discoveredSkills, browserProvider, disabledSkills, teamModeEnabled, "atlas")', 'result["atlas"] = atlasConfig'] },
  { path: rootPath("packages/omo-opencode/src/agents/builtin-agents/atlas-agent.ts"), category: "config override key", reason: "Public config key `atlas` is honored for disable checks, overrides, and fallback model preservation.", needles: ['disabledAgents.includes("atlas")', 'agentOverrides["atlas"]', 'AGENT_MODEL_REQUIREMENTS["atlas"]', 'agent: "atlas"'] },
  { path: rootPath("packages/omo-opencode/src/agents/atlas/agent.ts"), category: "prompt variants/prompts-core", reason: "Defines the Atlas user-facing identity plus prompt routing and prompt metadata.", needles: ['Atlas - Master Orchestrator Agent', 'agentName: "atlas"', 'name: "atlas"', 'promptAlias: "Atlas"', 'AtlasPromptSource', 'atlasPromptVariants'] },
  { path: rootPath("packages/omo-opencode/src/shared/agent-display-names.ts"), category: "docs/commands/user-facing names", reason: "Maps the public config key `atlas` to the UI-facing Atlas label and resolves legacy aliases.", needles: ['atlas: "Atlas - Plan Executor"', '"atlas (plan executor)": "atlas"', '"Atlas - Plan Executor" -> "atlas"'] },
  { path: rootPath("packages/omo-opencode/src/shared/model-requirements.ts"), category: "model requirements", reason: "Re-exports the canonical Atlas model requirements consumed by Atlas config resolution.", needles: ['AGENT_MODEL_REQUIREMENTS', 'CATEGORY_MODEL_REQUIREMENTS'] },
  { path: rootPath("packages/omo-opencode/src/agents/AGENTS.md"), category: "docs/commands/user-facing names", reason: "Documents Atlas as a built-in agent, its tool restrictions, mode, and canonical ordering.", needles: ['| **Atlas** | claude-sonnet-4-6 | 0.1 | primary |', '| Atlas | task, call_omo_agent |', '| `eligible` | sisyphus, atlas, sisyphus-junior |', 'Sisyphus → Hephaestus → Prometheus → Atlas'] },
  { path: rootPath("packages/omo-opencode/src/agents/atlas/AGENTS.md"), category: "docs/commands/user-facing names", reason: "Documents Atlas prompt files, routing, and registration path as a public developer reference.", needles: ['packages/prompts-core/prompts/atlas/default.md', 'packages/prompts-core/prompts/atlas/gpt.md', 'packages/prompts-core/prompts/atlas/gemini.md', 'packages/prompts-core/prompts/atlas/kimi.md', 'packages/prompts-core/prompts/atlas/opus-4-7.md'] },
  { path: rootPath("packages/prompts-core/prompts/atlas/default.md"), category: "prompt variants/prompts-core", reason: "Public default Atlas prompt surface bundled into the runtime prompt package.", needles: ['You are Atlas - the Master Orchestrator from OhMyOpenCode.'] },
  { path: rootPath("packages/prompts-core/prompts/atlas/gpt.md"), category: "prompt variants/prompts-core", reason: "Public GPT-optimized Atlas prompt variant.", needles: ['You are Atlas - Master Orchestrator from OhMyOpenCode, calibrated for GPT-5.5.'] },
  { path: rootPath("packages/prompts-core/prompts/atlas/gemini.md"), category: "prompt variants/prompts-core", reason: "Public Gemini-optimized Atlas prompt variant.", needles: ['You are Atlas - Master Orchestrator from OhMyOpenCode.'] },
  { path: rootPath("packages/prompts-core/prompts/atlas/glm.md"), category: "prompt variants/prompts-core", reason: "Public GLM-optimized Atlas prompt variant.", needles: ["You are Atlas, the Master Orchestrator from OhMyOpenCode, running on GLM 5.2."] },
  { path: rootPath("packages/prompts-core/prompts/atlas/kimi.md"), category: "prompt variants/prompts-core", reason: "Public Kimi-optimized Atlas prompt variant.", needles: ['You are Atlas - the Master Orchestrator from OhMyOpenCode, running on Kimi K2.6.'] },
  { path: rootPath("packages/prompts-core/prompts/atlas/kimi-k2-7.md"), category: "prompt variants/prompts-core", reason: "Public Kimi K2.7 Atlas prompt variant.", needles: ["You are Atlas, the master orchestrator from OhMyOpenCode, running on Kimi K2.7."] },
  { path: rootPath("packages/prompts-core/prompts/atlas/opus-4-7.md"), category: "prompt variants/prompts-core", reason: "Public Claude Opus 4.7 Atlas prompt variant.", needles: ['You are Atlas - the Master Orchestrator from OhMyOpenCode, running on Claude Opus 4.7.'] },
  { path: rootPath("packages/omo-opencode/src/features/builtin-commands/commands.ts"), category: "docs/commands/user-facing names", reason: "Resolves the public start-work command to Atlas when the agent is available.", needles: ['return isAgentRegistered("atlas") ? "atlas" : "sisyphus"', 'return "atlas"'] },
  { path: rootPath("packages/omo-opencode/src/features/builtin-commands/templates/start-work.ts"), category: "docs/commands/user-facing names", reason: "User-facing built-in command template explicitly instructs the Atlas workflow.", needles: ['atlas workflow', 'atlas delegation protocols'] },
  { path: rootPath("packages/omo-opencode/src/shared/agent-config-integration.test.ts"), category: "tests/snapshots public names", reason: "Locks the public config key, display name, and model requirement expectations for Atlas.", needles: ['Atlas', 'atlas', 'Atlas - Plan Executor'] },
  { path: rootPath("packages/omo-opencode/src/shared/dist-bundle-prompt-content.test.ts"), category: "tests/snapshots public names", reason: "Snapshots the prompt bundle paths and Atlas prompt signatures that must remain bundled.", needles: ['packages/prompts-core/prompts/atlas/default.md', 'Atlas default', 'Atlas Opus 4.7'] },
] as const

function listFiles(path: string): string[] {
  if (!existsSync(path)) return []
  const stat = statSync(path)
  if (stat.isFile()) return [path]
  if (!stat.isDirectory()) return []

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const childPath = resolve(path, entry.name)
    if (entry.isDirectory()) return listFiles(childPath)
    if (!entry.isFile()) return []
    return [childPath]
  })
}

function hasAtlasReference(path: string): boolean {
  if (path === inventoryFilePath) return false
  if (!/\.(?:jsonc?|md|mdx|ts)$/.test(path)) return false
  return /\batlas\b/i.test(readFileSync(path, "utf8"))
}

function discoverPublicAtlasSurfaceFiles(): string[] {
  return [...new Set(PUBLIC_SURFACE_SCOPES.flatMap((scope) => listFiles(scope)).filter(hasAtlasReference).map(relativePath))].sort()
}

describe("Atlas public surface inventory", () => {
  test("covers every public atlas reference in the curated surface files", () => {
    const missing: string[] = []

    for (const entry of INVENTORY) {
      const content = readFileSync(entry.path, "utf8")
      for (const needle of entry.needles) {
        if (!content.includes(needle)) missing.push(`${entry.path} :: ${needle}`)
      }
    }

    expect(missing, `Missing inventory entries:\n${missing.join("\n") || "(none)"}`).toEqual([])
  })

  test("inventory remains a source-backed compatibility map", () => {
    expect(INVENTORY.map((entry) => entry.category)).toContain("agent factory")
    expect(INVENTORY.map((entry) => entry.category)).toContain("config override key")
    expect(INVENTORY.map((entry) => entry.category)).toContain("docs/commands/user-facing names")
    expect(INVENTORY.map((entry) => entry.category)).toContain("model requirements")
    expect(INVENTORY.map((entry) => entry.category)).toContain("prompt variants/prompts-core")
    expect(INVENTORY.map((entry) => entry.category)).toContain("tests/snapshots public names")
  })

  test("discovers public atlas references that must stay inventoried", () => {
    const inventoried = new Set(INVENTORY.map((entry) => relativePath(entry.path)))
    const missing = discoverPublicAtlasSurfaceFiles().filter((path) => !inventoried.has(path))

    expect(missing, `Public Atlas surface files missing from inventory:\n${missing.join("\n") || "(none)"}`).toEqual([])
  })
})
