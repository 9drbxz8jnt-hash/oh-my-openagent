import type { Message, Part } from "@opencode-ai/sdk"
import type { ContextCollector } from "./collector"
import type { WorkspaceMemoryReader } from "./workspace-awareness"
import { isRealUserMessage, isRealUserTextPart, log } from "../../shared"
import { buildWorkspaceAwarenessPacket } from "./workspace-awareness"
import { getMainSessionID } from "../claude-code-session-state"

interface OutputPart {
  type: string
  text?: string
  [key: string]: unknown
}

interface InjectionResult {
  injected: boolean
  contextLength: number
}

export function injectPendingContext(
  collector: ContextCollector,
  sessionID: string,
  parts: OutputPart[]
): InjectionResult {
  if (!collector.hasPending(sessionID)) {
    return { injected: false, contextLength: 0 }
  }

  const textPartIndex = parts.findIndex(isRealUserTextPart)
  if (textPartIndex === -1) {
    return { injected: false, contextLength: 0 }
  }

  const pending = collector.consume(sessionID)
  const originalText = parts[textPartIndex].text ?? ""
  parts[textPartIndex].text = `${pending.merged}\n\n---\n\n${originalText}`

  return {
    injected: true,
    contextLength: pending.merged.length,
  }
}

interface ChatMessageInput {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
  messageID?: string
}

interface ChatMessageOutput {
  message: Record<string, unknown>
  parts: OutputPart[]
}

export function createContextInjectorHook(collector: ContextCollector) {
  return {
    "chat.message": async (
      input: ChatMessageInput,
      output: ChatMessageOutput
    ): Promise<void> => {
      const result = injectPendingContext(collector, input.sessionID, output.parts)
      if (result.injected) {
        log("[context-injector] Injected pending context via chat.message", {
          sessionID: input.sessionID,
          contextLength: result.contextLength,
        })
      }
    },
  }
}

interface MessageWithParts {
  info: Message
  parts: Part[]
}

type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => Promise<void>
}

function getSessionIDFromMessageInfo(info: Message): string | undefined {
  return "sessionID" in info && typeof info.sessionID === "string" ? info.sessionID : undefined
}

function hasText(part: Part): boolean {
  return "text" in part && typeof part.text === "string" && part.text.length > 0
}

function getWorkspaceRootFromMessageInfo(info: Message): string | undefined {
  if (!("path" in info)) {
    return undefined
  }

  const path = info.path as { root?: unknown; cwd?: unknown } | undefined
  if (!path) {
    return undefined
  }

  if (typeof path.root === "string" && path.root.length > 0) {
    return path.root
  }

  if (typeof path.cwd === "string" && path.cwd.length > 0) {
    return path.cwd
  }

  return undefined
}

export function createContextInjectorMessagesTransformHook(
  collector: ContextCollector,
  defaultWorkspaceRoot = process.cwd(),
  memoryReader?: WorkspaceMemoryReader,
): MessagesTransformHook {
  const preparedWorkspaceSessions = new Set<string>()

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output
      if (messages.length === 0) {
        return
      }

      let lastUserMessageIndex = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]
        if (message?.info.role === "user") {
          lastUserMessageIndex = i
          break
        }
      }

      if (lastUserMessageIndex === -1) {
        return
      }

      const lastUserMessage = messages[lastUserMessageIndex]
      if (lastUserMessage === undefined) {
        return
      }
      if (!isRealUserMessage(lastUserMessage)) {
        log("[context-injector] Latest user message is synthetic/internal, skipping injection", {
          sessionID: getSessionIDFromMessageInfo(lastUserMessage.info) ?? getMainSessionID(),
        })
        return
      }
      const messageSessionID = getSessionIDFromMessageInfo(lastUserMessage.info)
      const sessionID = messageSessionID ?? getMainSessionID()
      if (!sessionID) {
        return
      }

      const mainSessionID = getMainSessionID()
      const workspaceRoot = getWorkspaceRootFromMessageInfo(lastUserMessage.info) ?? defaultWorkspaceRoot
      if (
        workspaceRoot &&
        mainSessionID !== undefined &&
        sessionID === mainSessionID &&
        !preparedWorkspaceSessions.has(sessionID)
      ) {
        preparedWorkspaceSessions.add(sessionID)

        try {
          const packet = await buildWorkspaceAwarenessPacket({
            sessionID,
            workspaceRoot,
            memoryReader,
          })

          if (packet.memoryTimedOut) {
            log("[context-injector] Workspace memory lookup timed out; continuing without memory", {
              sessionID,
              workspaceRoot,
            })
          }

          if (packet.hasContent) {
            collector.register(sessionID, {
              id: `workspace-awareness:${sessionID}`,
              source: "custom",
              content: packet.content,
              priority: "low",
              metadata: {
                kind: "workspace-awareness",
                workspaceRoot,
                memoryTimedOut: packet.memoryTimedOut,
                memoryFactsUsed: packet.memoryFactsUsed,
                truncated: packet.truncated,
              },
            })
          }
        } catch (error) {
          log("[context-injector] Workspace awareness build failed; continuing without packet", {
            sessionID,
            workspaceRoot,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      const hasPending = collector.hasPending(sessionID)
      if (!hasPending) {
        return
      }

      const textPartIndex = lastUserMessage.parts.findIndex(
        (p) => isRealUserTextPart(p) && hasText(p)
      )

      if (textPartIndex === -1) {
        log("[context-injector] No text part found in last user message, skipping injection", {
          sessionID,
          partsCount: lastUserMessage.parts.length,
        })
        return
      }

      const pending = collector.consume(sessionID)
      if (!pending.hasContent) {
        return
      }

          const syntheticPart = {
            id: `prt_synthetic_hook_${sessionID}`,
            messageID: lastUserMessage.info.id,
            sessionID,
            type: "text" as const,
            text: pending.merged,
            synthetic: true,
          }

      lastUserMessage.parts.splice(textPartIndex, 0, syntheticPart as Part)

      log("[context-injector] Inserted synthetic part with hook content", {
        sessionID,
        contentLength: pending.merged.length,
      })
    },
  }
}
