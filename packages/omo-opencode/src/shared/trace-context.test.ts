import { describe, expect, test } from "bun:test"

import {
  type CreateTraceEventRecordInput,
  createChildDecisionTraceContext,
  createParentTaskTraceContext,
  createTraceEventRecord,
  getTracePropagation,
} from "./trace-context"

describe("trace context primitives", () => {
  test("keeps correlation IDs stable across a parent task and child decision context", () => {
    const parent = createParentTaskTraceContext({
      correlationId: "corr-parent-1",
      parentTaskId: "task-1",
    })

    const propagation = getTracePropagation(parent)
    const child = createChildDecisionTraceContext(propagation, {
      childDecisionId: "decision-1",
      decisionType: "supervisor_decision",
    })

    expect(parent.correlationId).toBe("corr-parent-1")
    expect(child.correlationId).toBe(parent.correlationId)
    expect(child.parentTaskId).toBe(parent.parentTaskId)
    expect(child.childDecisionId).toBe("decision-1")
    expect(child.decisionType).toBe("supervisor_decision")
  })

  test("does not log prompt content", () => {
    const leakSentinel = "LEAK_SENTINEL"
    const parent = createParentTaskTraceContext({
      correlationId: "corr-leak-1",
      parentTaskId: "task-leak-1",
    })
    const unsafeTraceInput: CreateTraceEventRecordInput & Record<string, string> = {
      eventName: "background_task_lifecycle",
      status: "started",
      prompt: `user prompt includes ${leakSentinel}`,
      userContent: `human text includes ${leakSentinel}`,
      providerResponse: `model output includes ${leakSentinel}`,
      rawEvidence: `log blob includes ${leakSentinel}`,
    }

    const record = createTraceEventRecord(parent, unsafeTraceInput)
    const capturedOutput = JSON.stringify(record)

    expect(capturedOutput).not.toContain(leakSentinel)
    expect(Object.keys(record).sort()).toEqual([
      "contextType",
      "correlationId",
      "eventName",
      "parentTaskId",
      "status",
    ])
  })
})
