import { randomUUID } from "node:crypto";
import { VelocityCodec } from "./codec";
import { computeDelta, shouldUseDelta } from "./delta";
import { splitJsonRpcBatchResponse } from "./passthrough-merge";
import { ProxySocket } from "./socket";
import { FrameRecord, VelocityEnvelope } from "./types";

interface EmitContext {
  sessionId: string;
  emit: (event: FrameRecord) => void;
  agentSocket: ProxySocket;
  latencyMs?: number;
}

export function handlePassthroughDownstream(
  ctx: EmitContext,
  outgoing: Buffer,
  isBinary: boolean,
  enablePassthroughMerge: boolean,
): boolean {
  const { agentSocket, emit, sessionId, latencyMs } = ctx;
  if (enablePassthroughMerge) {
    const split = splitJsonRpcBatchResponse(outgoing);
    if (split) {
      for (const item of split) {
        agentSocket.send(item, { binary: false });
        emit({
          ts: new Date().toISOString(),
          sessionId,
          direction: "server->agent",
          bytesRaw: outgoing.length,
          bytesSent: item.length,
          batchedCount: split.length,
          compressed: false,
          delta: false,
          queueDelayMs: 0,
          latencyMs,
          note: "passthrough-jsonrpc-split",
        });
      }
      return true;
    }
  }

  agentSocket.send(outgoing, { binary: isBinary });

  emit({
    ts: new Date().toISOString(),
    sessionId,
    direction: "server->agent",
    bytesRaw: outgoing.length,
    bytesSent: outgoing.length,
    batchedCount: 1,
    compressed: false,
    delta: false,
    queueDelayMs: 0,
    latencyMs,
    note: "passthrough-return",
  });
  return true;
}

interface VelocityFrameContext extends EmitContext {
  codec: VelocityCodec;
  parsedEnvelope: VelocityEnvelope;
  parsedCompressed: boolean;
  enableDelta: boolean;
  lastServerText: string;
  now: number;
  adaptiveWindowMs: number;
}

export async function handleVelocityDownstreamFrames(ctx: VelocityFrameContext): Promise<string> {
  const {
    agentSocket,
    codec,
    emit,
    sessionId,
    latencyMs,
