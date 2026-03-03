import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import { startProxy } from "./proxy";

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

test("proxy closes session when inbound queue exceeds limit", async () => {
  const upstreamPort = await getOpenPort();
  const proxyPort = await getOpenPort();
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: upstreamPort });
  upstream.on("connection", (socket) => {
    socket.on("message", () => {
      // keep upstream quiet so queue pressure is driven by agent burst.
    });
  });

  const proxy = await startProxy({
    target: `ws://127.0.0.1:${upstreamPort}`,
    listenHost: "127.0.0.1",
    listenPort: proxyPort,
    ingressH2H3Pilot: false,
    batchWindowMs: 100,
    batchMaxMessages: 64,
    batchMaxBytes: 131072,
    minBatchWindowMs: 0,
    maxBatchWindowMs: 100,
    latencyBudgetMs: 40,
    enableZstd: false,
    zstdMinBytes: 512,
    zstdMinGainRatio: 0.03,
    enableZstdDictionary: false,
    zstdDictionaryMinBytes: 1024,
    enableProtobuf: false,
    enableDelta: false,
    structuredDeltaTypes: [],
    autoFallback: true,
    enableNegotiation: false,
    negotiationTimeoutMs: 25,
    enablePassthroughMerge: true,
    safeMode: false,
    breakerThreshold: 3,
    breakerWindowMs: 30000,
    breakerCooldownMs: 60000,
    rollbackBreachThreshold: 3,
    rollbackWindowMs: 15000,
    maxInboundQueue: 2,
    maxOutstandingBatches: 32,
    maxSocketBackpressureBytes: 1024 * 1024,
    logFormat: "text",
    otlpHttpEndpoint: undefined,
    otlpIntervalMs: 10000,
    otlpServiceName: "velocity-test",
    metricsHost: "127.0.0.1",
    metricsPort: 0,
    traceDir: path.join(os.tmpdir(), `velocity-test-${Date.now()}`),
  });

  const agent = new WebSocket(`ws://127.0.0.1:${proxyPort}`);
  await new Promise<void>((resolve, reject) => {
    agent.once("open", () => resolve());
    agent.once("error", (err) => reject(err));
  });

  for (let i = 0; i < 10; i += 1) {
    agent.send(JSON.stringify({ jsonrpc: "2.0", id: i, method: "tool.call", params: { x: i } }));
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("expected proxy to close overflowing session")), 2000);
    agent.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    agent.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  await proxy.close();
  await new Promise<void>((resolve, reject) => upstream.close((err) => (err ? reject(err) : resolve())));
  assert.ok(true);
});
