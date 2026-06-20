export const RUNTIME_METRIC_NAMES = [
  "background_queue_depth",
  "runtime_timeout_hits",
  "cleanup_failures",
] as const

export type RuntimeMetricName = (typeof RUNTIME_METRIC_NAMES)[number]
export type RuntimeCounterMetricName = Exclude<RuntimeMetricName, "background_queue_depth">

export type RuntimeMetricsSnapshot = Record<RuntimeMetricName, number>

export interface RuntimeMetricsCollector {
  setQueueDepth: (depth: number) => void
  incrementCounter: (name: RuntimeCounterMetricName, amount?: number) => void
  getMetric: (name: RuntimeMetricName) => number
  getSnapshot: () => RuntimeMetricsSnapshot
  reset: () => void
}

export function createRuntimeMetricsCollector(): RuntimeMetricsCollector {
  const metrics = createEmptySnapshot()

  return {
    setQueueDepth: (depth) => {
      assertNonNegativeFiniteNumber(depth, "background_queue_depth")
      metrics.background_queue_depth = depth
    },
    incrementCounter: (name, amount = 1) => {
      assertNonNegativeFiniteNumber(amount, name)
      metrics[name] += amount
    },
    getMetric: (name) => metrics[name],
    getSnapshot: () => ({ ...metrics }),
    reset: () => {
      const empty = createEmptySnapshot()
      metrics.background_queue_depth = empty.background_queue_depth
      metrics.runtime_timeout_hits = empty.runtime_timeout_hits
      metrics.cleanup_failures = empty.cleanup_failures
    },
  }
}

function createEmptySnapshot(): RuntimeMetricsSnapshot {
  return {
    background_queue_depth: 0,
    runtime_timeout_hits: 0,
    cleanup_failures: 0,
  }
}

function assertNonNegativeFiniteNumber(value: number, metricName: RuntimeMetricName): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${metricName} must be a non-negative finite number`)
  }
}
