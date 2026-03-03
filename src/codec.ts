import { decode, encode } from "@msgpack/msgpack";
import { SerializedFrame, VelocityEnvelope } from "./types";

const FLAG_COMPRESSED = 1 << 0;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

interface ZstdFns {
  compress?: (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;
  decompress?: (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;
  init?: () => void | Promise<void>;
}

export interface VelocityCodecOptions {
  enableZstd: boolean;
  zstdMinBytes?: number;
  zstdMinGainRatio?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isValidCapabilities(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.protocolVersion === "number" &&
    typeof value.msgpack === "boolean" &&
    typeof value.zstd === "boolean" &&
    typeof value.delta === "boolean" &&
    typeof value.batching === "boolean" &&
    typeof value.adaptiveBatching === "boolean" &&
    typeof value.latencyBudgetMs === "number" &&
    typeof value.batchWindowMs === "number";
}

function isValidEnvelope(value: unknown): value is VelocityEnvelope {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > 256) {
    return false;
  }
  if (typeof value.sentAt !== "number" || !Number.isFinite(value.sentAt)) {
    return false;
  }
  if (!Array.isArray(value.frames)) {
    return false;
  }
  for (const frame of value.frames) {
    if (!(frame instanceof Uint8Array)) {
      return false;
    }
  }

  if (value.kind === "batch" || value.kind === "single") {
    return true;
  }

  if (value.kind === "delta") {
    if (!isRecord(value.deltaPatch)) {
      return false;
    }
    return typeof value.deltaPatch.prefix === "number" &&
      typeof value.deltaPatch.suffix === "number" &&
      typeof value.deltaPatch.changed === "string";
  }

  if (value.kind === "control") {
    if (!isRecord(value.control)) {
      return false;
    }
    if (value.control.type !== "hello" && value.control.type !== "hello-ack") {
      return false;
    }
    if (typeof value.control.ackFor !== "undefined" && typeof value.control.ackFor !== "string") {
      return false;
    }
    return isValidCapabilities(value.control.capabilities);
  }

  return false;
}

export class VelocityCodec {
  private readonly wantZstd: boolean;
  private readonly zstdMinBytes: number;
  private readonly zstdMinGainRatio: number;
  private zstd: ZstdFns | null = null;

  constructor(options: boolean | VelocityCodecOptions) {
    const normalized = typeof options === "boolean"
      ? { enableZstd: options, zstdMinBytes: 512, zstdMinGainRatio: 0.03 }
      : {
        enableZstd: options.enableZstd,
        zstdMinBytes: options.zstdMinBytes ?? 512,
        zstdMinGainRatio: options.zstdMinGainRatio ?? 0.03,
      };
    this.wantZstd = normalized.enableZstd;
    this.zstdMinBytes = Math.max(0, normalized.zstdMinBytes);
    this.zstdMinGainRatio = Math.max(0, Math.min(1, normalized.zstdMinGainRatio));
  }

  async init(): Promise<void> {
    if (!this.wantZstd) {
      return;
    }

