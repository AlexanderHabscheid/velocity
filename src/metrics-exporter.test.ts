import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startMetricsExporter } from "./metrics-exporter";
import { MetricsStore } from "./metrics-store";

async function getOpenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to bind open port"));
        return;
      }
      server.close((err) => (err ? reject(err) : resolve(address.port)));
    });
  });
}

test("metrics exporter exposes latency histogram buckets", async () => {
  const store = new MetricsStore(path.join(os.tmpdir(), `velocity-metrics-exporter-${Date.now()}`));
  store.record({
    ts: new Date().toISOString(),
    sessionId: "s1",
    direction: "agent->server",
    bytesRaw: 10,
    bytesSent: 8,
    batchedCount: 1,
    compressed: false,
    delta: false,
    queueDelayMs: 0,
    latencyMs: 7,
  });
  store.record({
    ts: new Date().toISOString(),
    sessionId: "s2",
    direction: "server->agent",
    bytesRaw: 10,
    bytesSent: 8,
    batchedCount: 1,
    compressed: false,
    delta: false,
    queueDelayMs: 0,
    latencyMs: 120,
  });
  store.recordSignal("policy-denied");
  store.recordSignal("auth-rejected");

  const port = await getOpenPort();
  const exporter = await startMetricsExporter(store, "127.0.0.1", port);
  const resp = await fetch(`http://127.0.0.1:${port}/metrics`);
  const body = await resp.text();

  assert.match(body, /velocity_latency_ms_bucket\{le="10"\} 1/);
  assert.match(body, /velocity_latency_ms_bucket\{le="250"\} 2/);
  assert.match(body, /velocity_latency_ms_count 2/);
  assert.match(body, /velocity_loop_turn_avg_ms /);
  assert.match(body, /velocity_frames_per_turn_avg /);
  assert.match(body, /velocity_queue_delay_avg_ms /);
  assert.match(body, /velocity_policy_denied_events_total 1/);
  assert.match(body, /velocity_auth_rejected_events_total 1/);

  await exporter.close();
  await store.close();
});
