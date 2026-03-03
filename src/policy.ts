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
  };
  const url = `${policy.opaEndpoint.replace(/\/+$/, "")}/v1/data/${normalizePath(policy.opaPath)}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input }),
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn("policy request failed", { status: response.status, tenantId, url });
      return { allow: policy.failOpen };
    }
    const body = await response.json() as OpaResponse;
    if (typeof body.result === "boolean") {
      return { allow: body.result };
    }
    return {
      allow: body.result?.allow !== false,
      rateLimitRps: typeof body.result?.rateLimitRps === "number" ? body.result.rateLimitRps : undefined,
    };
  } catch (err) {
    logger.warn("policy evaluation error", {
      tenantId,
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return { allow: policy.failOpen };
  } finally {
    clearTimeout(timeout);
  }
}
