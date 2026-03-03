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
