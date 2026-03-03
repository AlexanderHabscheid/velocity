import { randomUUID } from "node:crypto";
import { VelocityEnvelope } from "./types";

export interface VelocityCapabilities {
  protocolVersion: number;
  msgpack: boolean;
  zstd: boolean;
  delta: boolean;
  batching: boolean;
  adaptiveBatching: boolean;
  latencyBudgetMs: number;
  batchWindowMs: number;
}

export interface VelocityControl {
  type: "hello" | "hello-ack";
  ackFor?: string;
  capabilities: VelocityCapabilities;
}

export function buildHello(capabilities: VelocityCapabilities, ack = false, ackFor?: string): VelocityEnvelope {
  return {
    kind: "control",
    id: randomUUID(),
    sentAt: Date.now(),
    frames: [],
    control: {
      type: ack ? "hello-ack" : "hello",
      ackFor,
      capabilities,
    },
  };
}

export function isControlHello(envelope: VelocityEnvelope): boolean {
  return envelope.kind === "control" && envelope.control?.type === "hello";
}

export function isControlHelloAck(envelope: VelocityEnvelope): boolean {
  return envelope.kind === "control" && envelope.control?.type === "hello-ack";
