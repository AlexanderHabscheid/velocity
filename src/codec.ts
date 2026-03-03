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
