import { IncomingHttpHeaders } from "node:http";
import { Logger } from "./logger";
import { ProxyOptions } from "./types";

interface PolicyEvalParams {
  policy: NonNullable<ProxyOptions["policy"]>;
  tenantId: string;
  headers: IncomingHttpHeaders;
  remoteAddress?: string;
  logger: Logger;
}

interface OpaResponse {
  result?: boolean | {
    allow?: boolean;
    rateLimitRps?: number;
  };
}

export interface PolicyDecision {
  allow: boolean;
  rateLimitRps?: number;
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\/+/, "").replace(/\./g, "/");
}

export async function evaluatePolicy(params: PolicyEvalParams): Promise<PolicyDecision> {
  const { policy, tenantId, headers, remoteAddress, logger } = params;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(50, policy.timeoutMs));
  timeout.unref();
  const input = {
    tenantId,
    remoteAddress,
    headers: Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : (v ?? "")]),
    ),
    ts: new Date().toISOString(),
