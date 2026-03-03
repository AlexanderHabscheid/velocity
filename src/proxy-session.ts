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
  const hardGuard = new LatencyGuard({
    latencyBudgetMs: options.latencyBudgetMs,
    breachFactor: safeMode ? 1.0 : 1.1,
    recoveryFactor: safeMode ? 0.8 : 0.9,
    minSamples: safeMode ? 12 : 24,
    cooldownMs: safeMode ? 4000 : 2000,
  });
  const priorityQueue: PendingInbound[] = [];
  const normalQueue: PendingInbound[] = [];
  let priorityQueuedBytes = 0;
  let normalQueuedBytes = 0;
  const coalescer = new SemanticCoalescer(maxOutstandingBatches);
  const outstanding: OutstandingBatch[] = [];
  let outstandingHead = 0;
  let flushTimer: NodeJS.Timeout | null = null;
  let mode: UpstreamMode = options.enableNegotiation ? "unknown" : "velocity";
  let negotiationTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let tornDown = false;
  let upstreamReleased = false;
  let upstreamOpened = false;
  let lastServerText = "";
  let helloId: string | null = null;
  const localControlIds = new Set<string>();
  let forcedPassthrough = false;
  const heartbeatIntervalMs = Math.max(0, options.heartbeatIntervalMs ?? 25000);
  const heartbeatTimeoutMs = Math.max(1000, options.heartbeatTimeoutMs ?? 10000);
  let lastAgentPongAt = Date.now();
  let lastTargetPongAt = Date.now();
  const emit = (event: FrameRecord): void => {
    const withTenant: FrameRecord = { ...event, tenantId };
    store.record(withTenant);
    store.appendTrace(sessionId, withTenant);
    if (event.signal) {
      if (onSignal) {
        void onSignal(event.signal, event.note);
      }
