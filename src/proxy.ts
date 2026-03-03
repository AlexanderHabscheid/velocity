import { randomUUID } from "node:crypto";
import { CanaryPolicyManager } from "./canary-policy";
import { createLogger } from "./logger";
import { VelocityCodec } from "./codec";
import { startMetricsExporter } from "./metrics-exporter";
import { MetricsStore } from "./metrics-store";
import { startOtlpExporter } from "./otlp-exporter";
import { createProxySession } from "./proxy-session";
import { VelocityCapabilities } from "./protocol";
import { TenantCircuitBreakerRegistry } from "./runtime-safety";
import { ProxyOptions } from "./types";
import { evaluatePolicy } from "./policy";
import { ControlPlaneTenantRateLimiter, LocalTenantRateLimiter, TenantRateLimiter } from "./rate-limit";
import { startListener } from "./listener";
import { authenticateJwt } from "./authn";
import { evaluateOpenFgaAccess } from "./authz";
import { NatsEventBus, NoopEventBus, VelocityEventBus } from "./event-bus";
import { UpstreamPool } from "./upstream-pool";

export interface ProxyHandle {
  close: () => Promise<void>;
}

interface RuntimeProfileOverride {
  batchWindowMs: number;
  minBatchWindowMs: number;
  maxBatchWindowMs: number;
  latencyBudgetMs: number;
  batchMaxMessages: number;
  batchMaxBytes: number;
  enableZstd: boolean;
  enableDelta: boolean;
  safeMode: boolean;
  enablePassthroughMerge: boolean;
  updatedAt?: string;
}

function resolveTenantId(rawUrl: string | undefined, headerTenant: string | undefined): string {
  if (headerTenant && headerTenant.trim()) {
    return headerTenant.trim();
  }
  try {
    const parsed = new URL(rawUrl ?? "/", "ws://velocity.local");
    const fromQuery = parsed.searchParams.get("tenant");
    if (fromQuery && fromQuery.trim()) {
      return fromQuery.trim();
    }
  } catch {
    // ignore malformed URL
  }
  return "default";
}

export async function startProxy(options: ProxyOptions): Promise<ProxyHandle> {
  const logger = createLogger(options.logFormat);
  if (options.authn) {
    try {
      await import("jose");
    } catch {
      throw new Error("JWT auth configured but 'jose' is not installed. Install it with: npm install jose");
    }
  }
  const codec = new VelocityCodec({
    enableZstd: options.enableZstd,
    zstdMinBytes: options.zstdMinBytes,
    zstdMinGainRatio: options.zstdMinGainRatio,
  });
  await codec.init();

  const localCaps: VelocityCapabilities = {
    protocolVersion: 1,
    msgpack: true,
    zstd: options.enableZstd,
    delta: options.enableDelta,
    batching: true,
    adaptiveBatching: true,
    latencyBudgetMs: options.latencyBudgetMs,
    batchWindowMs: options.batchWindowMs,
  };

