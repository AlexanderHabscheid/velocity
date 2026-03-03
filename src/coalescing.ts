import { createHash } from "node:crypto";

type JsonRpcId = string | number | null;

interface PendingCoalescedRequest {
  signature: string;
  duplicateIds: JsonRpcId[];
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`);
  return `{${entries.join(",")}}`;
}

function idKey(id: JsonRpcId): string {
  return JSON.stringify(id);
}

function parseJsonObject(payload: Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(payload.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function computeSignature(method: string, params: unknown): string {
  const digest = createHash("sha1").update(canonicalJson(params)).digest("hex");
  return `${method}:${digest}`;
}

function isJsonRpcRequest(obj: Record<string, unknown>): obj is Record<string, unknown> & {
  jsonrpc: string;
  method: string;
  id: JsonRpcId;
  params?: unknown;
} {
  return obj.jsonrpc === "2.0" &&
    typeof obj.method === "string" &&
    Object.prototype.hasOwnProperty.call(obj, "id");
}

function isJsonRpcResponse(obj: Record<string, unknown>): obj is Record<string, unknown> & {
  jsonrpc: string;
  id: JsonRpcId;
} {
  return obj.jsonrpc === "2.0" && Object.prototype.hasOwnProperty.call(obj, "id");
}

export class SemanticCoalescer {
  private readonly signatureToPrimary = new Map<string, string>();
  private readonly primaryById = new Map<string, PendingCoalescedRequest>();
  private readonly maxPending: number;

  constructor(maxPending = 8192) {
    this.maxPending = Math.max(64, maxPending);
  }

  shouldCoalesceRequest(payload: Buffer): { coalesced: boolean; note?: string } {
    const req = parseJsonObject(payload);
    if (!req || !isJsonRpcRequest(req)) {
      return { coalesced: false };
    }
    if (typeof req.id !== "string" && typeof req.id !== "number") {
      return { coalesced: false };
    }
    const signature = computeSignature(req.method, req.params ?? null);
    const reqIdKey = idKey(req.id);
