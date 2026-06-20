/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { resolveMcpMergePolicy } from "./mcp-merge-policy"

describe("MCP merge policy helper", () => {
  test("applies precedence from built-ins to user .mcp.json to opencode config to plugin MCPs", () => {
    const result = resolveMcpMergePolicy({
      builtinMcps: {
        websearch: { type: "remote", url: "https://builtin.example.com", enabled: true },
        lsp: { type: "local", command: ["lsp"], enabled: true },
      },
      claudeCodeMcps: {
        websearch: { type: "remote", url: "https://mcp-json.example.com", enabled: true },
        context7: { type: "remote", url: "https://context7.example.com", enabled: true },
      },
      userMcp: {
        context7: { type: "remote", url: "https://user-config.example.com", enabled: true },
      },
      pluginMcps: {
        context7: { type: "remote", url: "https://plugin.example.com", enabled: true },
      },
      disabledMcps: [],
    })

    expect(result.merged.websearch.url).toBe("https://mcp-json.example.com")
    expect(result.merged.context7.url).toBe("https://plugin.example.com")
    expect(result.merged.lsp.command).toEqual(["lsp"])
    expect(result.userOverridesClaudeCodeMcpNames).toEqual(["context7"])
  })

  test("preserves enabled:false from opencode user config after plugin MCP precedence", () => {
    const result = resolveMcpMergePolicy({
      builtinMcps: {},
      claudeCodeMcps: {},
      userMcp: {
        custom: { type: "remote", url: "https://user.example.com", enabled: false },
      },
      pluginMcps: {
        custom: { type: "remote", url: "https://plugin.example.com", enabled: true },
      },
      disabledMcps: [],
    })

    expect(result.merged.custom).toEqual({
      type: "remote",
      url: "https://plugin.example.com",
      enabled: false,
    })
  })

  test("removes disabled entries after all MCP sources have been merged", () => {
    const result = resolveMcpMergePolicy({
      builtinMcps: {
        websearch: { type: "remote", url: "https://builtin.example.com", enabled: true },
      },
      claudeCodeMcps: {
        playwright: { type: "local", command: ["playwright"], enabled: true },
      },
      userMcp: {
        userServer: { type: "remote", url: "https://user.example.com", enabled: true },
      },
      pluginMcps: {
        pluginServer: { type: "local", command: ["plugin"], enabled: true },
      },
      disabledMcps: ["websearch", "playwright", "userServer", "pluginServer"],
    })

    expect(result.merged).toEqual({})
  })
})
