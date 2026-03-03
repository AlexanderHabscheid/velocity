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
      logger.warn("velocity signal", {
        sessionId,
        tenantId,
        direction: event.direction,
        signal: event.signal,
        note: event.note,
      });
      return;
    }
    if (event.note?.startsWith("hard-guard-")) {
      logger.info("velocity hard guard transition", {
        sessionId,
        tenantId,
        note: event.note,
        latencyMs: event.latencyMs,
      });
    }
  };
  const isSafetyForced = (): boolean => forcedPassthrough || safety.isTenantBreakerOpen();
  const isSocketBackpressured = (socket: ProxySocket): boolean => socket.bufferedAmount >= maxSocketBackpressureBytes;
  const totalInboundQueued = (): number => priorityQueue.length + normalQueue.length;
  const totalInboundQueuedBytes = (): number => priorityQueuedBytes + normalQueuedBytes;
  const classifyInbound = (payload: Buffer): { lane: "priority" | "normal"; streaming: boolean } => {
    try {
      const parsed = JSON.parse(payload.toString("utf8")) as { method?: string };
      const method = typeof parsed?.method === "string" ? parsed.method.toLowerCase() : "";
      const priority = /cancel|abort|interrupt|stop|final|error/.test(method);
      const streaming = /stream|token|delta/.test(method);
      return { lane: priority ? "priority" : "normal", streaming };
    } catch {
      return { lane: "normal", streaming: false };
    }
  };
  const compactOutstanding = (): void => {
    if (outstandingHead > 1024 && outstandingHead * 2 > outstanding.length) {
      outstanding.splice(0, outstandingHead);
      outstandingHead = 0;
    }
  };
  const outstandingSize = (): number => outstanding.length - outstandingHead;
  const shiftOutstanding = (): OutstandingBatch | undefined => {
    if (outstandingHead >= outstanding.length) {
      return undefined;
    }
    const item = outstanding[outstandingHead];
    outstandingHead += 1;
    compactOutstanding();
    return item;
  };
  const pushOutstanding = (item: OutstandingBatch): void => {
    if (outstandingSize() >= maxOutstandingBatches) {
      outstandingHead += 1;
      emit({
        ts: new Date().toISOString(),
        sessionId,
        direction: "agent->server",
        bytesRaw: 0,
        bytesSent: 0,
        batchedCount: 0,
        compressed: false,
        delta: false,
        queueDelayMs: 0,
        note: "outstanding-trimmed",
        signal: "queue-overflow",
      });
      compactOutstanding();
    }
    outstanding.push(item);
  };
  const requeueInbound = (entries: PendingInbound[]): void => {
    if (entries.length === 0) {
      return;
    }
    for (const entry of entries.reverse()) {
      if (entry.lane === "priority") {
        priorityQueue.unshift(entry);
        priorityQueuedBytes += entry.payload.length;
      } else {
        normalQueue.unshift(entry);
        normalQueuedBytes += entry.payload.length;
      }
    }
  };
  const takeInboundBatch = (): PendingInbound[] => {
    if (priorityQueue.length > 0) {
      const entry = priorityQueue.shift() as PendingInbound;
      priorityQueuedBytes = Math.max(0, priorityQueuedBytes - entry.payload.length);
      return [entry];
    }
    if (normalQueue.length === 0) {
      return [];
    }
    if (normalQueue[0].streaming) {
      const entry = normalQueue.shift() as PendingInbound;
      normalQueuedBytes = Math.max(0, normalQueuedBytes - entry.payload.length);
      return [entry];
    }
    const maxMessages = Math.max(1, options.batchMaxMessages);
    const maxBytes = Math.max(1, options.batchMaxBytes);
    let bytes = 0;
    let count = 0;
    for (let idx = 0; idx < normalQueue.length && count < maxMessages; idx += 1) {
      if (normalQueue[idx].streaming && count > 0) {
        break;
      }
      const size = normalQueue[idx].payload.length;
      if (count > 0 && bytes + size > maxBytes) {
        break;
      }
      bytes += size;
      count += 1;
    }
    if (count <= 0) {
      count = 1;
      bytes = normalQueue[0].payload.length;
    }
    const entries = normalQueue.splice(0, count);
    normalQueuedBytes = Math.max(0, normalQueuedBytes - bytes);
    return entries;
  };
  const shouldFlushImmediately = (): boolean =>
    priorityQueue.length > 0 ||
    (normalQueue.length > 0 && normalQueue[0].streaming) ||
    normalQueue.length >= Math.max(1, options.batchMaxMessages) ||
    totalInboundQueuedBytes() >= Math.max(1, options.batchMaxBytes);
  const shouldFavorLatency = (queueDelayMs: number, count: number): boolean => {
    if (options.latencyBudgetMs > 15) {
      return false;
    }
    if (count <= 3) {
      return true;
    }
    return queueDelayMs > 0.75;
  };

  const setMode = (next: UpstreamMode, note: string): void => {
    if (mode === next) {
      return;
    }
    mode = next;
    emit({
      ts: new Date().toISOString(),
      sessionId,
      direction: "agent->server",
      bytesRaw: 0,
      bytesSent: 0,
      batchedCount: 0,
      compressed: false,
      delta: false,
      queueDelayMs: 0,
      note,
    });
  };
  const flushBatch = async (): Promise<void> => {
    if (targetSocket.readyState !== SOCKET_STATE.OPEN || totalInboundQueued() === 0) {
      return;
    }
    if (isSocketBackpressured(targetSocket)) {
      emit({
        ts: new Date().toISOString(),
        sessionId,
        direction: "agent->server",
        bytesRaw: 0,
        bytesSent: 0,
        batchedCount: 0,
        compressed: false,
        delta: false,
        queueDelayMs: 0,
        note: `target-backpressure(buffered=${targetSocket.bufferedAmount})`,
        signal: "backpressure",
      });
      return;
    }
    const entries = takeInboundBatch();
    if (entries.length === 0) {
      return;
    }
    const now = Date.now();
    const queueDelayMs = entries.reduce((sum, x) => sum + (now - x.enqueuedAt), 0) / entries.length;
    if (isSafetyForced() && mode !== "passthrough") {
      setMode("passthrough", forcedPassthrough ? "session-rollback-passthrough" : "tenant-breaker-passthrough");
    }
    if (mode === "passthrough" || mode === "unknown") {
      const guardActive = hardGuard.isGuarded();
      if (
        options.enablePassthroughMerge &&
        !guardActive &&
        !isSafetyForced() &&
        entries[0]?.lane !== "priority" &&
        !entries[0]?.streaming &&
        !shouldFavorLatency(queueDelayMs, entries.length)
      ) {
        const merged = tryMergeJsonRpcBatch(entries.map((x) => x.payload));
        if (merged) {
          if (isSocketBackpressured(targetSocket)) {
            requeueInbound(entries);
            return;
          }
          targetSocket.send(merged, { binary: false });
          pushOutstanding({ sentAt: now, queueDelayMs, count: entries.length });
          emit({
            ts: new Date().toISOString(),
            sessionId,
            direction: "agent->server",
            bytesRaw: entries.reduce((sum, x) => sum + x.payload.length, 0),
            bytesSent: merged.length,
            batchedCount: entries.length,
            compressed: false,
            delta: false,
            queueDelayMs,
            note: mode === "unknown" ? "provisional-jsonrpc-batch" : "passthrough-jsonrpc-batch",
          });
          return;
        }
      }
      for (let idx = 0; idx < entries.length; idx += 1) {
        if (isSocketBackpressured(targetSocket)) {
          requeueInbound(entries.slice(idx));
          return;
        }
        const entry = entries[idx];
        targetSocket.send(entry.payload, { binary: true });
        pushOutstanding({ sentAt: now, queueDelayMs, count: 1 });
        emit({
          ts: new Date().toISOString(),
          sessionId,
          direction: "agent->server",
          bytesRaw: entry.payload.length,
          bytesSent: entry.payload.length,
          batchedCount: 1,
          compressed: false,
          delta: false,
          queueDelayMs,
          note: mode === "unknown" ? "provisional-direct" : "passthrough-direct",
        });
      }
      return;
    }
    if (
      options.latencyBudgetMs <= 15 &&
      entries.length > 1 &&
      options.enablePassthroughMerge &&
      entries[0]?.lane !== "priority" &&
      !entries[0]?.streaming &&
      !isSafetyForced() &&
      !hardGuard.isGuarded()
    ) {
      const merged = tryMergeJsonRpcBatch(entries.map((x) => x.payload));
      if (merged) {
        if (isSocketBackpressured(targetSocket)) {
          requeueInbound(entries);
          return;
        }
        targetSocket.send(merged, { binary: false });
        pushOutstanding({ sentAt: now, queueDelayMs, count: entries.length });
        emit({
          ts: new Date().toISOString(),
          sessionId,
          direction: "agent->server",
          bytesRaw: entries.reduce((sum, x) => sum + x.payload.length, 0),
          bytesSent: merged.length,
          batchedCount: entries.length,
          compressed: false,
          delta: false,
          queueDelayMs,
          note: "low-latency-jsonrpc-batch",
        });
        return;
      }
    }
    const shouldBypass = isSafetyForced() ||
      hardGuard.isGuarded() ||
      shouldFavorLatency(queueDelayMs, entries.length) ||
      (options.autoFallback && controller.shouldBypassBatching());
    if (entries.length === 1 || shouldBypass) {
      for (let idx = 0; idx < entries.length; idx += 1) {
        if (isSocketBackpressured(targetSocket)) {
          requeueInbound(entries.slice(idx));
          return;
        }
        const entry = entries[idx];
        const envelope: VelocityEnvelope = {
          kind: "single",
          id: randomUUID(),
          sentAt: now,
          frames: [entry.payload],
          source: "velocity",
        };
        const encoded = await codec.serialize(envelope, { allowCompression: options.enableZstd });
        targetSocket.send(encoded.buffer, { binary: true });
        pushOutstanding({ sentAt: now, queueDelayMs, count: 1 });
        emit({
          ts: new Date().toISOString(),
          sessionId,
          direction: "agent->server",
          bytesRaw: entry.payload.length,
          bytesSent: encoded.buffer.length,
          batchedCount: 1,
          compressed: encoded.compressed,
          delta: false,
          queueDelayMs,
          note: isSafetyForced()
            ? "safety-forced-bypass"
            : hardGuard.isGuarded()
              ? "hard-guard-bypass"
              : shouldBypass
                ? "adaptive-bypass"
                : "single",
        });
      }
      return;
    }
    const envelope: VelocityEnvelope = {
      kind: "batch",
      id: randomUUID(),
      sentAt: now,
      frames: entries.map((x) => x.payload),
      source: "velocity",
    };
    const encoded = await codec.serialize(envelope, { allowCompression: options.enableZstd });
    if (isSocketBackpressured(targetSocket)) {
      requeueInbound(entries);
      return;
    }
    targetSocket.send(encoded.buffer, { binary: true });
    pushOutstanding({ sentAt: now, queueDelayMs, count: entries.length });
    emit({
      ts: new Date().toISOString(),
      sessionId,
      direction: "agent->server",
      bytesRaw: entries.reduce((sum, x) => sum + x.payload.length, 0),
      bytesSent: encoded.buffer.length,
      batchedCount: entries.length,
      compressed: encoded.compressed,
      delta: false,
      queueDelayMs,
      note: `batch@${controller.currentWindowMs()}ms`,
    });
  };
  const scheduleFlush = (overrideWaitMs?: number): void => {
    const waitMs = Math.max(
      0,
      typeof overrideWaitMs === "number"
        ? overrideWaitMs
        : mode === "velocity" && !hardGuard.isGuarded() && !isSafetyForced()
        ? controller.currentWindowMs()
        : 0,
    );
    if (flushTimer) {
      if (waitMs > 0) {
        return;
      }
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      await flushBatch();
      if (totalInboundQueued() > 0 && targetSocket.readyState === SOCKET_STATE.OPEN) {
        scheduleFlush(1);
      }
    }, waitMs);
  };
  agentSocket.on("message", async (data) => {
    if (totalInboundQueued() >= maxInboundQueue) {
      emit({
        ts: new Date().toISOString(),
        sessionId,
        direction: "agent->server",
        bytesRaw: 0,
        bytesSent: 0,
        batchedCount: 0,
        compressed: false,
        delta: false,
        queueDelayMs: 0,
        note: `inbound-queue-overflow(limit=${maxInboundQueue})`,
        signal: "queue-overflow",
      });
      teardown();
      return;
    }
    const payload = toBuffer(data as WebSocket.RawData);
    const maybeCoalesced = coalescer.shouldCoalesceRequest(payload);
    if (maybeCoalesced.coalesced) {
      emit({
        ts: new Date().toISOString(),
        sessionId,
        direction: "agent->server",
        bytesRaw: payload.length,
        bytesSent: 0,
        batchedCount: 1,
        compressed: false,
        delta: false,
        queueDelayMs: 0,
        note: maybeCoalesced.note,
      });
      return;
    }
    const classified = classifyInbound(payload);
    const entry: PendingInbound = { payload, enqueuedAt: Date.now(), lane: classified.lane, streaming: classified.streaming };
    if (entry.lane === "priority") {
      priorityQueue.push(entry);
      priorityQueuedBytes += payload.length;
    } else {
      normalQueue.push(entry);
      normalQueuedBytes += payload.length;
    }
    if (targetSocket.readyState === SOCKET_STATE.OPEN) {
      scheduleFlush(shouldFlushImmediately() ? 0 : undefined);
    }
  });
  targetSocket.on("open", async () => {
    upstreamOpened = true;
    upstreamObserver?.onOpen?.();
    if (options.enableNegotiation) {
      const hello = buildHello(localCaps, false);
      const encoded = await codec.serialize(hello, { allowCompression: options.enableZstd });
      helloId = hello.id;
      localControlIds.add(hello.id);
      targetSocket.send(encoded.buffer, { binary: true });
      emit({
        ts: new Date().toISOString(),
        sessionId,
        direction: "agent->server",
        bytesRaw: encoded.buffer.length,
        bytesSent: encoded.buffer.length,
        batchedCount: 1,
        compressed: encoded.compressed,
        delta: false,
        queueDelayMs: 0,
        note: "hello-sent",
      });
      negotiationTimer = setTimeout(async () => {
        setMode("passthrough", "hello-timeout->passthrough");
        await flushBatch();
      }, options.negotiationTimeoutMs);
    } else {
      setMode("velocity", "negotiation-disabled");
    }
    await flushBatch();
  });
  targetSocket.on("message", async (data, isBinary = true) => {
    if (isSocketBackpressured(agentSocket)) {
      emit({
        ts: new Date().toISOString(),
        sessionId,
        direction: "server->agent",
        bytesRaw: 0,
        bytesSent: 0,
        batchedCount: 0,
        compressed: false,
        delta: false,
        queueDelayMs: 0,
        note: `agent-backpressure(buffered=${agentSocket.bufferedAmount})`,
        signal: "backpressure",
      });
      teardown();
      return;
    }
    const now = Date.now();
    const outgoing = toBuffer(data as WebSocket.RawData);
    const batch = shiftOutstanding();
    const latencyMs = batch ? now - batch.sentAt : undefined;
    if (batch && typeof latencyMs === "number") {
      upstreamObserver?.onLatency?.(latencyMs);
      emit({
        ts: new Date().toISOString(),
        sessionId,
        metricsOnly: true,
        direction: "server->agent",
        bytesRaw: 0,
        bytesSent: 0,
        batchedCount: 0,
        compressed: false,
        delta: false,
        queueDelayMs: batch.queueDelayMs,
        latencyMs,
        loopTurnMs: latencyMs,
        toolRoundtripMs: latencyMs,
        framesPerTurn: batch.count,
        note: "loop-turn-sample",
      });
      controller.onOutbound(batch.queueDelayMs, batch.count);
      controller.onInbound(latencyMs);
      const guard = hardGuard.record(latencyMs);
      if (guard.changed) {
        emit({
          ts: new Date().toISOString(),
          sessionId,
          direction: "agent->server",
          bytesRaw: 0,
          bytesSent: 0,
          batchedCount: 0,
          compressed: false,
          delta: false,
          queueDelayMs: 0,
          latencyMs,
          note: guard.guarded ? `hard-guard-on(p95=${guard.p95.toFixed(2)}ms)` : `hard-guard-off(p95=${guard.p95.toFixed(2)}ms)`,
        });
        if (guard.guarded) {
          const breaker = safety.recordTenantBreach();
          if (breaker.opened) {
            emit({
              ts: new Date().toISOString(),
              sessionId,
              direction: "agent->server",
              bytesRaw: 0,
              bytesSent: 0,
              batchedCount: 0,
              compressed: false,
              delta: false,
              queueDelayMs: 0,
              note: `tenant-breaker-open(tenant=${tenantId},until=${breaker.openUntil})`,
              signal: "tenant-breaker-open",
            });
          }
          const rb = rollback.recordGuardBreach();
          if (rb.rollback) {
            forcedPassthrough = true;
            emit({
              ts: new Date().toISOString(),
              sessionId,
              direction: "agent->server",
              bytesRaw: 0,
              bytesSent: 0,
              batchedCount: 0,
              compressed: false,
              delta: false,
              queueDelayMs: 0,
              note: "session-rollback-triggered",
              signal: "session-rollback",
            });
            setMode("passthrough", "session-rollback-hard-guard");
          }
        }
      }
    }
    const parsed = isBinary ? await codec.parse(outgoing).catch(() => null) : null;
    if (mode === "unknown") {
      if (parsed && parsed.envelope.kind === "control") {
        if (localControlIds.has(parsed.envelope.id)) {
          return;
        }
        if (isControlHello(parsed.envelope)) {
          const ack = buildHello(localCaps, true, parsed.envelope.id);
          localControlIds.add(ack.id);
          const ackEncoded = await codec.serialize(ack, { allowCompression: options.enableZstd });
          targetSocket.send(ackEncoded.buffer, { binary: true });
          return;
        }
        if (isControlHelloAck(parsed.envelope) && parsed.envelope.control?.ackFor === helloId) {
          if (negotiationTimer) {
            clearTimeout(negotiationTimer);
            negotiationTimer = null;
          }
          setMode("velocity", "hello-acknowledged");
          await flushBatch();
          return;
        }
      }
      if (!parsed) {
        if (negotiationTimer) {
          clearTimeout(negotiationTimer);
          negotiationTimer = null;
        }
        setMode("passthrough", "non-velocity-upstream");
        const expanded = coalescer.expandResponse(outgoing);
        for (const response of expanded) {
          handlePassthroughDownstream(
            { sessionId, emit, agentSocket, latencyMs },
            response,
            Boolean(isBinary),
            options.enablePassthroughMerge,
          );
        }
        await flushBatch();
        return;
      }
    }
    if (mode === "passthrough" || !parsed) {
      const expanded = coalescer.expandResponse(outgoing);
      for (const response of expanded) {
        handlePassthroughDownstream(
          { sessionId, emit, agentSocket, latencyMs },
