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
