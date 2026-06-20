import { randomUUID } from "node:crypto"

export type TraceEventName =
  | "supervisor_decision"
  | "background_task_lifecycle"
  | "memory_candidate"
  | "parent_wake_dispatch"

export type TraceEventStatus = "started" | "completed" | "failed" | "skipped"

export interface TracePropagation {
  correlationId: string
  parentTaskId?: string
}

export interface ParentTaskTraceContext extends TracePropagation {
  contextType: "parent_task"
}

export interface ChildDecisionTraceContext extends TracePropagation {
  contextType: "child_decision"
  childDecisionId: string
  decisionType: TraceEventName
}

export type TraceContext = ParentTaskTraceContext | ChildDecisionTraceContext

export interface CreateParentTaskTraceContextInput {
  correlationId?: string
  parentTaskId?: string
}

export interface CreateChildDecisionTraceContextInput {
  childDecisionId?: string
  decisionType: TraceEventName
}

export interface CreateTraceEventRecordInput {
  eventName: TraceEventName
  status?: TraceEventStatus
}

export interface TraceEventRecord {
  eventName: TraceEventName
  correlationId: string
  contextType: TraceContext["contextType"]
  parentTaskId?: string
  childDecisionId?: string
  decisionType?: TraceEventName
  status?: TraceEventStatus
}

export function createParentTaskTraceContext(
  input: CreateParentTaskTraceContextInput = {},
): ParentTaskTraceContext {
  const context: ParentTaskTraceContext = {
    contextType: "parent_task",
    correlationId: input.correlationId ?? createTraceId("corr"),
  }

  if (input.parentTaskId !== undefined) {
    context.parentTaskId = input.parentTaskId
  }

  return context
}

export function getTracePropagation(context: TracePropagation): TracePropagation {
  const propagation: TracePropagation = {
    correlationId: context.correlationId,
  }

  if (context.parentTaskId !== undefined) {
    propagation.parentTaskId = context.parentTaskId
  }

  return propagation
}

export function createChildDecisionTraceContext(
  parent: TracePropagation,
  input: CreateChildDecisionTraceContextInput,
): ChildDecisionTraceContext {
  const context: ChildDecisionTraceContext = {
    contextType: "child_decision",
    correlationId: parent.correlationId,
    childDecisionId: input.childDecisionId ?? createTraceId("decision"),
    decisionType: input.decisionType,
  }

  if (parent.parentTaskId !== undefined) {
    context.parentTaskId = parent.parentTaskId
  }

  return context
}

export function createTraceEventRecord(
  context: TraceContext,
  input: CreateTraceEventRecordInput,
): TraceEventRecord {
  const record: TraceEventRecord = {
    eventName: input.eventName,
    correlationId: context.correlationId,
    contextType: context.contextType,
  }

  if (context.parentTaskId !== undefined) {
    record.parentTaskId = context.parentTaskId
  }

  if (context.contextType === "child_decision") {
    record.childDecisionId = context.childDecisionId
    record.decisionType = context.decisionType
  }

  if (input.status !== undefined) {
    record.status = input.status
  }

  return record
}

function createTraceId(prefix: string): string {
  return `${prefix}_${randomUUID()}`
}
