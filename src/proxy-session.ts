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
