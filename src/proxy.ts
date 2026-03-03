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

  const store = new MetricsStore(options.traceDir);
  const upstreamPool = options.targetPool && options.targetPool.targets.length > 0
    ? new UpstreamPool(options.targetPool, logger)
    : null;
  upstreamPool?.start();
  const eventBus: VelocityEventBus = options.eventBus?.natsUrl
    ? await NatsEventBus.create(options.eventBus.natsUrl, options.eventBus.subjectPrefix)
    : new NoopEventBus();
  const publishEvent = async (topic: string, payload: Record<string, unknown>): Promise<void> => {
    try {
      await eventBus.publish(topic, payload);
    } catch (err) {
      logger.warn("velocity event publish failed", {
        topic,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
  const breakers = new TenantCircuitBreakerRegistry({
    threshold: options.breakerThreshold,
    windowMs: options.breakerWindowMs,
    cooldownMs: options.breakerCooldownMs,
  });
  const rateLimiter: TenantRateLimiter = options.rateLimit?.controlPlaneEndpoint
    ? new ControlPlaneTenantRateLimiter(
      options.rateLimit.controlPlaneEndpoint,
      options.rateLimit.timeoutMs,
      options.rateLimit.failOpen,
      logger,
    )
    : new LocalTenantRateLimiter();
  let runtimeProfileOverride: RuntimeProfileOverride | null = null;
  let runtimePollTimer: NodeJS.Timeout | null = null;
  if (options.runtimeControlPlaneEndpoint?.trim()) {
    const poll = async (): Promise<void> => {
      try {
        const resp = await fetch(`${options.runtimeControlPlaneEndpoint}/v1/runtime/profile`);
        if (!resp.ok) {
          return;
        }
        const body = await resp.json() as RuntimeProfileOverride;
        runtimeProfileOverride = body;
      } catch {
        // swallow runtime polling errors
      }
    };
    await poll();
    const pollMs = Math.max(500, options.runtimeControlPlanePollMs ?? 5000);
    runtimePollTimer = setInterval(() => {
      void poll();
    }, pollMs);
    runtimePollTimer.unref();
  }
  const canary = options.canary
    ? new CanaryPolicyManager({
      percent: options.canary.percent,
      promotionWindowMs: options.canary.promotionWindowMs,
      minSessions: options.canary.minSessions,
      stateFile: options.canary.stateFile,
    })
    : null;
  const listener = await startListener({
    host: options.listenHost,
    port: options.listenPort,
    engine: options.listenerEngine ?? "ws",
    maxPayloadBytes: options.listenerMaxPayloadBytes,
    logger,
    onConnection: async (agentSocket, req) => {
      const tenantId = resolveTenantId(req.url, req.headers["x-velocity-tenant"]?.toString());
      let identityClaims: Record<string, unknown> = {};
      if (options.authn) {
        try {
          const identity = await authenticateJwt(req.headers, options.authn);
          if (!identity) {
            logger.warn("velocity auth rejected session", { tenantId, reason: "missing_or_invalid_token" });
            store.recordSignal("auth-rejected", tenantId);
            void publishEvent("proxy.auth_rejected", { tenantId, reason: "missing_or_invalid_token" });
            agentSocket.close(1008, "unauthorized");
            return;
          }
