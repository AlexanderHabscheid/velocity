import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";
import { loadOutboundReduction } from "./bench-metrics";
import { createRng, hashSeed } from "./bench-rng";
import { startProxy } from "./proxy";

export interface BenchProfile {
  name: string;
  messages: number;
  burst: number;
  payloadBytes: number;
  batchWindowMs: number;
  minBatchWindowMs: number;
  maxBatchWindowMs: number;
  latencyBudgetMs: number;
  serverDelayMs: number;
  jitterMs: number;
  maxP95DeltaMs: number;
  maxAvgDeltaMs: number;
  minFrameReductionPct: number;
  minByteReductionPct: number;
}

interface TrialResult {
  latencies: number[];
  logicalBytesSent: number;
  logicalBytesReceived: number;
  elapsedMs: number;
}

export interface BenchProfileResult {
  profile: BenchProfile;
  direct: TrialResult;
  proxied: TrialResult;
  frameReductionPct: number;
  byteReductionPct: number;
  p95DeltaMs: number;
  avgDeltaMs: number;
  p95DeltaPct: number;
  avgDeltaPct: number;
  pass: boolean;
  stateDir: string;
}

export interface BenchReport {
  generatedAt: string;
  results: BenchProfileResult[];
  passCount: number;
  failCount: number;
}

export const DEFAULT_CI_PROFILES: BenchProfile[] = [
  {
    name: "low-latency-lan",
    messages: 600,
    burst: 12,
    payloadBytes: 512,
    batchWindowMs: 1,
    minBatchWindowMs: 0,
    maxBatchWindowMs: 4,
    latencyBudgetMs: 12,
    serverDelayMs: 2,
    jitterMs: 1,
    maxP95DeltaMs: 10,
    maxAvgDeltaMs: 6,
    minFrameReductionPct: -1,
    minByteReductionPct: 90,
  },
  {
    name: "regional",
    messages: 500,
    burst: 20,
    payloadBytes: 1024,
    batchWindowMs: 3,
    minBatchWindowMs: 0,
    maxBatchWindowMs: 8,
    latencyBudgetMs: 40,
    serverDelayMs: 20,
    jitterMs: 4,
    maxP95DeltaMs: 8,
    maxAvgDeltaMs: 6,
    minFrameReductionPct: -1,
    minByteReductionPct: 95,
  },
  {
    name: "mobile-edge",
    messages: 350,
    burst: 24,
    payloadBytes: 1536,
    batchWindowMs: 5,
    minBatchWindowMs: 1,
    maxBatchWindowMs: 12,
    latencyBudgetMs: 120,
    serverDelayMs: 80,
    jitterMs: 12,
    maxP95DeltaMs: 12,
    maxAvgDeltaMs: 10,
    minFrameReductionPct: -1,
    minByteReductionPct: 97,
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function createPayload(length: number): string {
  const unit = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  while (out.length < length) {
    out += unit;
  }
  return out.slice(0, length);
}

function parseJsonMessage(data: WebSocket.RawData): { id: number } | null {
  const text = Buffer.isBuffer(data)
    ? data.toString("utf8")
    : Array.isArray(data)
      ? Buffer.concat(data.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString("utf8")
      : Buffer.from(data).toString("utf8");

  try {
    const parsed = JSON.parse(text) as { id?: number; result?: { id?: number } };
    if (typeof parsed.id === "number") {
      return { id: parsed.id };
    }
    if (parsed.result && typeof parsed.result.id === "number") {
      return { id: parsed.result.id };
    }
    return null;
  } catch {
    return null;
  }
}

async function getOpenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to allocate a local port"));
        return;
      }
      server.close((err) => (err ? reject(err) : resolve(address.port)));
    });
  });
}

async function runTrial(url: string, profile: BenchProfile): Promise<TrialResult> {
  const latencies: number[] = [];
  const sentAt = new Map<number, number>();
  const payload = createPayload(profile.payloadBytes);
  let logicalBytesSent = 0;
  let logicalBytesReceived = 0;

  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", (err) => reject(err));
  });

  const started = Date.now();
  let parsedCount = 0;
  const done = new Promise<void>((resolve, reject) => {
    ws.on("message", (data) => {
      logicalBytesReceived += Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data), "utf8");
      const parsedMessage = parseJsonMessage(data);
      if (!parsedMessage) {
        return;
      }
      const start = sentAt.get(parsedMessage.id);
      if (typeof start !== "number") {
        return;
      }
      parsedCount += 1;
      latencies.push(Date.now() - start);
      sentAt.delete(parsedMessage.id);
      if (parsedCount >= profile.messages) {
        resolve();
      }
    });

    ws.on("error", (err) => reject(err));
    ws.on("close", () => {
      if (latencies.length < profile.messages) {
        reject(new Error("socket closed before all responses arrived"));
      }
    });
  });

  for (let i = 0; i < profile.messages; i += profile.burst) {
    const end = Math.min(profile.messages, i + profile.burst);
    for (let id = i; id < end; id += 1) {
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tool.call",
        params: { payload },
      });
      sentAt.set(id, Date.now());
      logicalBytesSent += Buffer.byteLength(body, "utf8");
      ws.send(body);
    }
    await sleep(1);
  }

  const timeout = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error(`timeout waiting for responses; pending=${sentAt.size}`)), 45000);
  });

  await Promise.race([done, timeout]);
  ws.close();

  return {
    latencies,
    logicalBytesSent,
    logicalBytesReceived,
    elapsedMs: Date.now() - started,
  };
}

export async function runProfile(profile: BenchProfile, runSeed = 1): Promise<BenchProfileResult> {
  const serverPort = await getOpenPort();
  const proxyPort = await getOpenPort();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), `velocity-bench-${profile.name}-${randomUUID()}-`));

  const rng = createRng(hashSeed(`${profile.name}:${runSeed}`));
  const echoServer = new WebSocketServer({ host: "127.0.0.1", port: serverPort });
  echoServer.on("connection", (socket) => {
    socket.on("message", (data, isBinary) => {
      const jitter = profile.jitterMs > 0 ? Math.floor(rng() * (profile.jitterMs + 1)) : 0;
      const delay = profile.serverDelayMs + jitter;
      setTimeout(() => {
        if (socket.readyState === WebSocket.OPEN) {
          const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
          try {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
              const responses = parsed.map((item) => ({
                jsonrpc: "2.0",
                id: (item as { id?: unknown }).id,
                result: item,
              }));
              socket.send(JSON.stringify(responses), { binary: false });
              return;
            }
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              const request = parsed as { id?: unknown };
              socket.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: request.id,
                  result: request,
                }),
                { binary: false },
              );
              return;
            }
          } catch {
            // passthrough non-JSON payloads
          }
          socket.send(data, { binary: isBinary });
        }
      }, delay);
    });
  });

  const directUrl = `ws://127.0.0.1:${serverPort}`;
  const proxyUrl = `ws://127.0.0.1:${proxyPort}`;

  const proxy = await startProxy({
    target: directUrl,
    listenHost: "127.0.0.1",
    listenPort: proxyPort,
    ingressH2H3Pilot: false,
    batchWindowMs: profile.batchWindowMs,
    batchMaxMessages: 64,
    batchMaxBytes: 131072,
    minBatchWindowMs: profile.minBatchWindowMs,
    maxBatchWindowMs: profile.maxBatchWindowMs,
    latencyBudgetMs: profile.latencyBudgetMs,
    enableZstd: false,
    zstdMinBytes: 512,
    zstdMinGainRatio: 0.03,
    enableZstdDictionary: false,
    zstdDictionaryMinBytes: 1024,
    enableProtobuf: false,
    enableDelta: false,
    structuredDeltaTypes: [],
    autoFallback: true,
    enableNegotiation: true,
    negotiationTimeoutMs: 25,
    enablePassthroughMerge: true,
    safeMode: false,
    breakerThreshold: 3,
    breakerWindowMs: 30000,
    breakerCooldownMs: 60000,
    rollbackBreachThreshold: 3,
    rollbackWindowMs: 15000,
    maxInboundQueue: 4096,
    maxOutstandingBatches: 8192,
    maxSocketBackpressureBytes: 4 * 1024 * 1024,
    logFormat: "text",
    otlpHttpEndpoint: undefined,
    otlpIntervalMs: 10000,
    otlpServiceName: "velocity-bench",
    metricsHost: "127.0.0.1",
    metricsPort: 0,
    traceDir: stateDir,
  });

  let direct: TrialResult | null = null;
  let proxied: TrialResult | null = null;
  try {
    await sleep(120);
    direct = await runTrial(directUrl, profile);
    await sleep(80);
    proxied = await runTrial(proxyUrl, profile);
  } finally {
    await proxy.close();
    await new Promise<void>((resolve, reject) => {
      echoServer.close((err) => (err ? reject(err) : resolve()));
    });
  }

