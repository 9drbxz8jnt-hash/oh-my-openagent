import { describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import {
  createLifecycleMemoryCandidateRecorder,
  type LifecycleMemoryCandidate,
  type LifecycleMemoryCandidateTraceEvent,
} from "../../shared/lifecycle-memory-candidate"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

function cast<T>(value: unknown): T {
  return value as T
}

function createPluginInput(client: unknown, directory: string): PluginInput {
  return cast<PluginInput>({ client, directory })
}

function createRunningTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "bg_memory_candidate",
    sessionId: "ses_child_memory",
    parentSessionId: "ses_parent_memory",
    parentMessageId: "msg_parent_memory",
    description: "Record launch-provided memory candidate",
    prompt: "RAW PROMPT BODY MUST NOT BE STORED",
    agent: "sisyphus-junior",
    status: "running",
    startedAt: new Date("2026-06-20T10:00:00.000Z"),
    memoryCandidates: [
      {
        fact: "Background completion can submit launch-provided durable facts without writing MemPalace directly.",
        source: "packages/omo-opencode/src/features/background-agent/manager.ts",
        confidence: "high",
        why: "Future lifecycle memory work should keep writes behind supervisor governance.",
      },
    ],
    ...overrides,
  }
}

async function tryCompleteTaskForTest(manager: BackgroundManager, task: BackgroundTask): Promise<boolean> {
  return (cast<{ tryCompleteTask: (task: BackgroundTask, source: string) => Promise<boolean> }>(manager))
    .tryCompleteTask(task, "session.idle event")
}

function stubNotifyParentSession(manager: BackgroundManager): void {
  ;(cast<{ notifyParentSession: (task: BackgroundTask) => Promise<void> }>(manager)).notifyParentSession = async () => {}
}

function stubLaunchScheduling(manager: BackgroundManager): void {
  ;(cast<{
    reserveSubagentSpawn: () => Promise<{
      spawnContext: { rootSessionID: string; parentDepth: number; childDepth: number }
      descendantCount: number
      commit: () => number
      rollback: () => void
    }>
    processKey: (key: string) => Promise<void>
  }>(manager)).reserveSubagentSpawn = async () => ({
    spawnContext: { rootSessionID: "ses_parent_memory", parentDepth: 0, childDepth: 1 },
    descendantCount: 1,
    commit: () => 1,
    rollback: () => {},
  })
  ;(cast<{ processKey: (key: string) => Promise<void> }>(manager)).processKey = async () => {}
}

describe("BackgroundManager lifecycle memory candidates", () => {
  test("#given launch receives supervisor memory candidates #when the launched task completes #then completion records those bounded facts", async () => {
    //#given
    const candidates: LifecycleMemoryCandidate[] = []
    const recorder = createLifecycleMemoryCandidateRecorder({
      workspaceRoot: "/tmp/omo-memory-test",
      sink: { submit: mock(async (candidate: LifecycleMemoryCandidate) => candidates.push(candidate)) },
      localStore: { append: mock(async () => {}) },
    })
    const manager = new BackgroundManager({
      pluginContext: createPluginInput({ session: { abort: mock(async () => ({})) } }, "/tmp/omo-memory-test"),
      lifecycleMemoryRecorder: recorder,
    })
    stubNotifyParentSession(manager)
    stubLaunchScheduling(manager)

    const launchedTask = await manager.launch({
      description: "Record launch-provided memory candidate",
      prompt: "RAW PROMPT BODY MUST NOT BE STORED",
      agent: "sisyphus-junior",
      parentSessionId: "ses_parent_memory",
      parentMessageId: "msg_parent_memory",
      memoryCandidates: [
        {
          fact: "Supervisor approved launch fact should flow into completion candidate.",
          source: "packages/omo-opencode/src/tools/delegate-task",
          confidence: "high",
          why: "Launch is the cold production boundary for parent-governed durable facts.",
        },
      ],
    })
    const storedTask = manager.getTask(launchedTask.id)
    if (!storedTask) throw new Error("expected launched task to be stored")
    storedTask.status = "running"

    //#when
    const completed = await tryCompleteTaskForTest(manager, storedTask)

    //#then
    expect(completed).toBe(true)
    expect(storedTask.memoryCandidates).toHaveLength(1)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.facts[0]?.fact).toContain("Supervisor approved launch fact")
    expect(JSON.stringify(candidates)).not.toContain("RAW PROMPT BODY")
  })

  test("#given a completed background task with launch-provided memory facts #when completion runs #then it submits a governed candidate and local summary without prompt text", async () => {
    //#given
    const candidates: LifecycleMemoryCandidate[] = []
    const localSummaries: LifecycleMemoryCandidate[] = []
    const traceEvents: LifecycleMemoryCandidateTraceEvent[] = []
    const recorder = createLifecycleMemoryCandidateRecorder({
      workspaceRoot: "/tmp/omo-memory-test",
      sink: { submit: mock(async (candidate: LifecycleMemoryCandidate) => candidates.push(candidate)) },
      localStore: { append: mock(async (candidate: LifecycleMemoryCandidate) => localSummaries.push(candidate)) },
      trace: (event) => traceEvents.push(event),
    })
    const client = {
      session: {
        abort: mock(async () => ({})),
      },
    }
    const manager = new BackgroundManager({
      pluginContext: createPluginInput(client, "/tmp/omo-memory-test"),
      lifecycleMemoryRecorder: recorder,
    })
    stubNotifyParentSession(manager)
    const task = createRunningTask()

    //#when
    const completed = await tryCompleteTaskForTest(manager, task)

    //#then
    expect(completed).toBe(true)
    expect(task.status).toBe("completed")
    expect(candidates).toHaveLength(1)
    expect(localSummaries).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      kind: "background_task_completion",
      decisionOwner: "parent_supervisor",
      sessionID: "ses_child_memory",
      parentSessionID: "ses_parent_memory",
      taskId: "bg_memory_candidate",
    })
    expect(candidates[0]?.facts[0]?.fact).toContain("launch-provided durable facts")
    expect(candidates[0]?.correlationId).toContain("bg_memory_candidate")
    expect(traceEvents.some((event) => event.type === "memory_candidate.created")).toBe(true)
    expect(JSON.stringify(candidates)).not.toContain("RAW PROMPT BODY")
    expect(JSON.stringify(localSummaries)).not.toContain("RAW PROMPT BODY")
    expect(JSON.stringify(traceEvents)).not.toContain("RAW PROMPT BODY")
  })

  test("#given the governance candidate sink throws #when completion runs #then the background task remains completed and failure trace is recorded", async () => {
    //#given
    const traceEvents: LifecycleMemoryCandidateTraceEvent[] = []
    const recorder = createLifecycleMemoryCandidateRecorder({
      workspaceRoot: "/tmp/omo-memory-test",
      sink: {
        submit: mock(async () => {
          throw new Error("governance unavailable")
        }),
      },
      localStore: { append: mock(async () => {}) },
      trace: (event) => traceEvents.push(event),
    })
    const client = {
      session: {
        abort: mock(async () => ({})),
      },
    }
    const manager = new BackgroundManager({
      pluginContext: createPluginInput(client, "/tmp/omo-memory-test"),
      lifecycleMemoryRecorder: recorder,
    })
    stubNotifyParentSession(manager)
    const task = createRunningTask()

    //#when
    const completed = await tryCompleteTaskForTest(manager, task)

    //#then
    expect(completed).toBe(true)
    expect(task.status).toBe("completed")
    expect(task.error).toBeUndefined()
    const failureTrace = traceEvents.find((event) => event.type === "memory_candidate.write_failed")
    expect(failureTrace).toMatchObject({
      type: "memory_candidate.write_failed",
      taskId: "bg_memory_candidate",
      sessionID: "ses_child_memory",
    })
    expect(failureTrace?.correlationId).toContain("bg_memory_candidate")
    expect(JSON.stringify(traceEvents)).not.toContain("RAW PROMPT BODY")
  })
})
