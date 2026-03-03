import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { AdaptiveBatchController } from "./adaptive";
import { VelocityCodec } from "./codec";
import { LatencyGuard } from "./latency-guard";
import { Logger } from "./logger";
import { MetricsStore } from "./metrics-store";
import { handlePassthroughDownstream, handleVelocityDownstreamFrames } from "./proxy-downstream";
import { tryMergeJsonRpcBatch } from "./passthrough-merge";
import { buildHello, isControlHello, isControlHelloAck, VelocityCapabilities } from "./protocol";
import { SessionRollbackController } from "./runtime-safety";
import { ProxySocket, SOCKET_STATE } from "./socket";
import { FrameRecord, ProxyOptions, VelocityEnvelope } from "./types";
import { toBuffer } from "./ws-buffer";
import { SemanticCoalescer } from "./coalescing";
interface PendingInbound {
  payload: Buffer;
  enqueuedAt: number;
  lane: "priority" | "normal";
  streaming: boolean;
}
interface OutstandingBatch {
  sentAt: number;
  queueDelayMs: number;
  count: number;
}
type UpstreamMode = "unknown" | "velocity" | "passthrough";
interface SessionParams {
  agentSocket: ProxySocket;
  targetUrl: string;
  sessionId: string;
  codec: VelocityCodec;
  store: MetricsStore;
  options: ProxyOptions;
  localCaps: VelocityCapabilities;
  logger: Logger;
  tenantId: string;
  safety: {
    isTenantBreakerOpen: () => boolean;
    recordTenantBreach: () => { opened: boolean; openUntil?: number };
  };
  upstreamObserver?: {
    onOpen?: () => void;
    onClose?: () => void;
    onError?: (reason: string) => void;
    onLatency?: (latencyMs: number) => void;
  };
  onSignal?: (signal: NonNullable<FrameRecord["signal"]>, note?: string) => Promise<void>;
}
export function createProxySession(params: SessionParams): void {
  const {
    agentSocket,
    targetUrl,
    sessionId,
    codec,
    store,
    options,
    localCaps,
    logger,
    tenantId,
    safety,
    upstreamObserver,
    onSignal,
  } = params;
  const targetSocket = new WebSocket(targetUrl, {
    handshakeTimeout: Math.max(1, options.upstreamHandshakeTimeoutMs ?? 10000),
    maxPayload: Math.max(1024, options.upstreamMaxPayloadBytes ?? 100 * 1024 * 1024),
    perMessageDeflate: options.upstreamPerMessageDeflate ?? true,
  }) as unknown as ProxySocket;
  const safeMode = options.safeMode;
  const maxInboundQueue = Math.max(1, options.maxInboundQueue);
  const maxOutstandingBatches = Math.max(1, options.maxOutstandingBatches);
  const maxSocketBackpressureBytes = Math.max(1024, options.maxSocketBackpressureBytes);
  const rollback = new SessionRollbackController(options.rollbackBreachThreshold, options.rollbackWindowMs);
  const controller = new AdaptiveBatchController({
    initialWindowMs: safeMode ? Math.min(1, options.batchWindowMs) : options.batchWindowMs,
    minWindowMs: options.minBatchWindowMs,
    maxWindowMs: safeMode ? Math.min(2, options.maxBatchWindowMs) : options.maxBatchWindowMs,
    latencyBudgetMs: options.latencyBudgetMs,
  });
