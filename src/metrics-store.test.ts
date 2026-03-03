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
  store.recordSignal("rate-limit-denied", "acme");
  store.recordSignal("auth-rejected", "acme");
  store.recordSignal("authz-denied", "acme");

  const loaded = store.load();
  assert.equal(loaded.queueOverflowEvents, 1);
  assert.equal(loaded.backpressureEvents, 1);
  assert.equal(loaded.policyDeniedEvents, 1);
  assert.equal(loaded.rateLimitDeniedEvents, 1);
  assert.equal(loaded.authRejectedEvents, 1);
  assert.equal(loaded.authzDeniedEvents, 1);
  assert.equal(loaded.perTenant.acme.totalFramesRaw, 0);
  assert.equal(loaded.perTenant.acme.totalFramesSent, 2);
  assert.equal(loaded.perTenant.acme.policyDeniedEvents, 1);
  assert.equal(loaded.latencyHistogram["+Inf"] ?? 0, 0);
});
