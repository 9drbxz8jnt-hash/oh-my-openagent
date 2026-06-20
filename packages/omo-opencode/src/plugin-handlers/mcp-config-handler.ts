import type { OhMyOpenCodeConfig } from "../config";
import { loadMcpConfigs } from "../features/claude-code-mcp-loader";
import { createBuiltinMcps } from "../mcp";
import { log } from "../shared";
import { type McpEntry, resolveMcpMergePolicy } from "./mcp-merge-policy";
import type { PluginComponents } from "./plugin-components-loader";

export async function applyMcpConfig(params: {
  config: Record<string, unknown>;
  ctx: { directory: string };
  pluginConfig: OhMyOpenCodeConfig;
  pluginComponents: PluginComponents;
}): Promise<void> {
  const disabledMcps = params.pluginConfig.disabled_mcps ?? [];
  const userMcp = params.config.mcp as Record<string, unknown> | undefined;

  const mcpResult = params.pluginConfig.claude_code?.mcp ?? true
    ? await loadMcpConfigs(disabledMcps)
    : { servers: {} };

  const mergePolicy = resolveMcpMergePolicy({
    builtinMcps: createBuiltinMcps(disabledMcps, params.pluginConfig, { cwd: params.ctx.directory }) as Record<string, McpEntry>,
    claudeCodeMcps: mcpResult.servers as Record<string, McpEntry>,
    userMcp,
    pluginMcps: params.pluginComponents.mcpServers as Record<string, McpEntry>,
    disabledMcps,
  });

  for (const name of mergePolicy.userOverridesClaudeCodeMcpNames) {
    log(`warning: MCP server "${name}" from user config overrides Claude Code .mcp.json`);
  }

  params.config.mcp = mergePolicy.merged;
}
