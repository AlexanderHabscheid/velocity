import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { AggregateMetrics, FrameRecord, TenantAggregateMetrics } from "./types";

const DEFAULT_METRICS: AggregateMetrics = {
  totalFramesRaw: 0,
  totalFramesSent: 0,
  totalBytesRaw: 0,
  totalBytesSent: 0,
  totalBatches: 0,
  totalBatchMembers: 0,
  totalCompressedFrames: 0,
  totalDeltaFrames: 0,
  latencySamples: 0,
  latencyMsTotal: 0,
  latencyMsP95Window: [],
  loopTurnSamples: 0,
  loopTurnMsTotal: 0,
  toolRoundtripSamples: 0,
  toolRoundtripMsTotal: 0,
  framesPerTurnSamples: 0,
  framesPerTurnTotal: 0,
  queueDelaySamples: 0,
  queueDelayMsTotal: 0,
  queueDelayMsP95Window: [],
  latencyHistogram: {},
  queueOverflowEvents: 0,
  backpressureEvents: 0,
  tenantBreakerOpenEvents: 0,
  sessionRollbackEvents: 0,
  policyDeniedEvents: 0,
  rateLimitDeniedEvents: 0,
  authRejectedEvents: 0,
  authzDeniedEvents: 0,
  perTenant: {},
  updatedAt: new Date(0).toISOString(),
};

const EMPTY_TENANT_METRICS: TenantAggregateMetrics = {
  totalFramesRaw: 0,
  totalFramesSent: 0,
  totalBytesRaw: 0,
  totalBytesSent: 0,
  latencySamples: 0,
  latencyMsTotal: 0,
  loopTurnSamples: 0,
  loopTurnMsTotal: 0,
  toolRoundtripSamples: 0,
  toolRoundtripMsTotal: 0,
  framesPerTurnSamples: 0,
  framesPerTurnTotal: 0,
  queueDelaySamples: 0,
  queueDelayMsTotal: 0,
  queueOverflowEvents: 0,
  backpressureEvents: 0,
  tenantBreakerOpenEvents: 0,
  sessionRollbackEvents: 0,
  policyDeniedEvents: 0,
  rateLimitDeniedEvents: 0,
  authRejectedEvents: 0,
  authzDeniedEvents: 0,
};

export class MetricsStore {
  private readonly root: string;
  private readonly metricsFile: string;
  private readonly traceRoot: string;
  private metrics: AggregateMetrics;
  private metricsDirty = false;
  private readonly traceBuffers = new Map<string, string[]>();
  private flushing = false;
  private flushQueued = false;
  private closePromise: Promise<void> | null = null;

  constructor(root = path.resolve(process.cwd(), ".velocity")) {
    this.root = root;
    this.metricsFile = path.join(this.root, "metrics.json");
    this.traceRoot = path.join(this.root, "traces");
    fs.mkdirSync(this.traceRoot, { recursive: true });
    this.metrics = this.readMetricsFile();
  }

  private readMetricsFile(): AggregateMetrics {
    if (!fs.existsSync(this.metricsFile)) {
      return { ...DEFAULT_METRICS };
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.metricsFile, "utf8")) as AggregateMetrics;
      return { ...DEFAULT_METRICS, ...parsed };
    } catch {
      return { ...DEFAULT_METRICS };
    }
  }

  getTracePath(sessionId: string): string {
    return path.join(this.traceRoot, `${sessionId}.jsonl`);
  }

  load(): AggregateMetrics {
    return {
      ...this.metrics,
      latencyMsP95Window: [...this.metrics.latencyMsP95Window],
      queueDelayMsP95Window: [...this.metrics.queueDelayMsP95Window],
      latencyHistogram: { ...this.metrics.latencyHistogram },
      perTenant: Object.fromEntries(
        Object.entries(this.metrics.perTenant ?? {}).map(([tenantId, stats]) => [tenantId, { ...stats }]),
      ),
    };
  }

  private getTenantMetrics(tenantId: string): TenantAggregateMetrics {
    const current = this.metrics.perTenant[tenantId];
    if (current) {
      const merged = { ...EMPTY_TENANT_METRICS, ...current };
      this.metrics.perTenant[tenantId] = merged;
      return merged;
    }
    const next = { ...EMPTY_TENANT_METRICS };
    this.metrics.perTenant[tenantId] = next;
    return next;
  }

  record(event: FrameRecord): void {
    const tenant = event.tenantId?.trim() || "default";
    const perTenant = this.getTenantMetrics(tenant);
    if (!event.metricsOnly) {
      this.metrics.totalFramesRaw += event.batchedCount;
      perTenant.totalFramesRaw += event.batchedCount;
      this.metrics.totalFramesSent += 1;
      perTenant.totalFramesSent += 1;
      this.metrics.totalBytesRaw += event.bytesRaw;
      perTenant.totalBytesRaw += event.bytesRaw;
      this.metrics.totalBytesSent += event.bytesSent;
      perTenant.totalBytesSent += event.bytesSent;
      if (event.batchedCount > 1) {
        this.metrics.totalBatches += 1;
        this.metrics.totalBatchMembers += event.batchedCount;
      }
      if (event.compressed) {
        this.metrics.totalCompressedFrames += 1;
      }
      if (event.delta) {
        this.metrics.totalDeltaFrames += 1;
      }
    }
    if (typeof event.latencyMs === "number") {
      this.metrics.latencySamples += 1;
      perTenant.latencySamples += 1;
      this.metrics.latencyMsTotal += event.latencyMs;
      perTenant.latencyMsTotal += event.latencyMs;
      this.metrics.latencyMsP95Window.push(event.latencyMs);
      this.recordLatencyHistogram(event.latencyMs);
      if (this.metrics.latencyMsP95Window.length > 5000) {
        this.metrics.latencyMsP95Window.splice(0, this.metrics.latencyMsP95Window.length - 5000);
      }
    }
    if (event.queueDelayMs > 0) {
      this.metrics.queueDelaySamples += 1;
      this.metrics.queueDelayMsTotal += event.queueDelayMs;
      this.metrics.queueDelayMsP95Window.push(event.queueDelayMs);
      perTenant.queueDelaySamples += 1;
      perTenant.queueDelayMsTotal += event.queueDelayMs;
      if (this.metrics.queueDelayMsP95Window.length > 5000) {
        this.metrics.queueDelayMsP95Window.splice(0, this.metrics.queueDelayMsP95Window.length - 5000);
      }
    }
    if (typeof event.loopTurnMs === "number") {
      this.metrics.loopTurnSamples += 1;
      this.metrics.loopTurnMsTotal += event.loopTurnMs;
      perTenant.loopTurnSamples += 1;
      perTenant.loopTurnMsTotal += event.loopTurnMs;
    }
    if (typeof event.toolRoundtripMs === "number") {
      this.metrics.toolRoundtripSamples += 1;
      this.metrics.toolRoundtripMsTotal += event.toolRoundtripMs;
      perTenant.toolRoundtripSamples += 1;
      perTenant.toolRoundtripMsTotal += event.toolRoundtripMs;
    }
    if (typeof event.framesPerTurn === "number") {
      this.metrics.framesPerTurnSamples += 1;
      this.metrics.framesPerTurnTotal += event.framesPerTurn;
      perTenant.framesPerTurnSamples += 1;
      perTenant.framesPerTurnTotal += event.framesPerTurn;
    }
    if (event.signal) {
      this.recordSignal(event.signal, tenant);
    }
    this.metrics.updatedAt = new Date().toISOString();
    this.metricsDirty = true;
  }

  recordSignal(signal: NonNullable<FrameRecord["signal"]>, tenantId = "default"): void {
    const perTenant = this.getTenantMetrics(tenantId);
    if (signal === "queue-overflow") {
      this.metrics.queueOverflowEvents += 1;
      perTenant.queueOverflowEvents += 1;
    }
    if (signal === "backpressure") {
      this.metrics.backpressureEvents += 1;
      perTenant.backpressureEvents += 1;
    }
    if (signal === "tenant-breaker-open") {
      this.metrics.tenantBreakerOpenEvents += 1;
      perTenant.tenantBreakerOpenEvents += 1;
    }
    if (signal === "session-rollback") {
      this.metrics.sessionRollbackEvents += 1;
      perTenant.sessionRollbackEvents += 1;
    }
    if (signal === "policy-denied") {
      this.metrics.policyDeniedEvents += 1;
      perTenant.policyDeniedEvents += 1;
    }
    if (signal === "rate-limit-denied") {
      this.metrics.rateLimitDeniedEvents += 1;
      perTenant.rateLimitDeniedEvents += 1;
    }
    if (signal === "auth-rejected") {
      this.metrics.authRejectedEvents += 1;
      perTenant.authRejectedEvents += 1;
    }
    if (signal === "authz-denied") {
      this.metrics.authzDeniedEvents += 1;
      perTenant.authzDeniedEvents += 1;
    }
    this.metrics.updatedAt = new Date().toISOString();
    this.metricsDirty = true;
  }

  private recordLatencyHistogram(latencyMs: number): void {
    const bounds = [1, 2, 5, 10, 20, 50, 100, 250, 500, 1000];
