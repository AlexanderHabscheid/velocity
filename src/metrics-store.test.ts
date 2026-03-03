import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MetricsStore } from "./metrics-store";

test("metrics store tracks overflow and backpressure signals", () => {
  const store = new MetricsStore(path.join(os.tmpdir(), `velocity-metrics-test-${Date.now()}`));

  store.record({
    ts: new Date().toISOString(),
    sessionId: "s1",
    tenantId: "acme",
    direction: "agent->server",
    bytesRaw: 0,
    bytesSent: 0,
    batchedCount: 0,
    compressed: false,
    delta: false,
    queueDelayMs: 0,
    signal: "queue-overflow",
    note: "overflow",
  });

  store.record({
    ts: new Date().toISOString(),
    sessionId: "s1",
    tenantId: "acme",
    direction: "server->agent",
    bytesRaw: 0,
    bytesSent: 0,
    batchedCount: 0,
    compressed: false,
    delta: false,
    queueDelayMs: 0,
    signal: "backpressure",
    note: "bp",
  });

  store.recordSignal("policy-denied", "acme");
