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
