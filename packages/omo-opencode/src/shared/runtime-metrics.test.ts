import { describe, expect, test } from "bun:test"

import { createRuntimeMetricsCollector, RUNTIME_METRIC_NAMES } from "./runtime-metrics"

describe("runtime metrics primitives", () => {
  test("queue depth timeout hits cleanup failures update in memory without an exporter", () => {
    const metrics = createRuntimeMetricsCollector()

    metrics.setQueueDepth(3)
    metrics.incrementCounter("runtime_timeout_hits")
    metrics.incrementCounter("runtime_timeout_hits", 2)
    metrics.incrementCounter("cleanup_failures")

    expect(RUNTIME_METRIC_NAMES).toEqual([
      "background_queue_depth",
      "runtime_timeout_hits",
      "cleanup_failures",
    ])
    expect(metrics.getSnapshot()).toEqual({
      background_queue_depth: 3,
      runtime_timeout_hits: 3,
      cleanup_failures: 1,
    })
    expect(metrics.getMetric("background_queue_depth")).toBe(3)
  })
})
