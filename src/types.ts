export type Direction = "agent->server" | "server->agent";

export interface ProxyOptions {
  target: string;
  targetPool?: {
    targets: string[];
    ewmaAlpha: number;
    ejectFailures: number;
    ejectMs: number;
    probeIntervalMs: number;
    probeTimeoutMs: number;
    initialLatencyMs: number;
    connectionPenaltyMs: number;
    failurePenaltyMs: number;
    unhealthyPenaltyMs: number;
  };
  listenHost: string;
  listenPort: number;
  listenerEngine?: "ws" | "uwebsockets";
  listenerMaxPayloadBytes?: number;
  ingressH2H3Pilot: boolean;
  batchWindowMs: number;
  batchMaxMessages: number;
  batchMaxBytes: number;
  minBatchWindowMs: number;
  maxBatchWindowMs: number;
  latencyBudgetMs: number;
  enableZstd: boolean;
  zstdMinBytes: number;
  zstdMinGainRatio: number;
  enableZstdDictionary: boolean;
  zstdDictionaryBase64?: string;
  zstdDictionaryMinBytes: number;
  enableProtobuf: boolean;
  enableDelta: boolean;
  structuredDeltaTypes: string[];
  autoFallback: boolean;
  enableNegotiation: boolean;
  negotiationTimeoutMs: number;
  enablePassthroughMerge: boolean;
  safeMode: boolean;
  breakerThreshold: number;
  breakerWindowMs: number;
  breakerCooldownMs: number;
  rollbackBreachThreshold: number;
  rollbackWindowMs: number;
  maxInboundQueue: number;
  maxOutstandingBatches: number;
  maxSocketBackpressureBytes: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  upstreamHandshakeTimeoutMs?: number;
  upstreamMaxPayloadBytes?: number;
  upstreamPerMessageDeflate?: boolean;
  logFormat: "text" | "json";
  otlpHttpEndpoint?: string;
  otlpIntervalMs: number;
  otlpServiceName: string;
  metricsHost?: string;
  metricsPort?: number;
  canary?: {
    percent: number;
    promotionWindowMs: number;
    minSessions: number;
    stateFile?: string;
  };
  policy?: {
    opaEndpoint: string;
    opaPath: string;
    timeoutMs: number;
    failOpen: boolean;
  };
  rateLimit?: {
    controlPlaneEndpoint: string;
    timeoutMs: number;
    failOpen: boolean;
  };
  authn?: {
    required: boolean;
    jwksUrl: string;
    issuer?: string;
    audience?: string;
  };
  authz?: {
    endpoint: string;
    storeId: string;
    modelId?: string;
    relation: string;
    objectPrefix: string;
    userClaim: string;
    failOpen: boolean;
    token?: string;
    timeoutMs: number;
  };
  eventBus?: {
    natsUrl: string;
    subjectPrefix: string;
  };
  runtimeControlPlaneEndpoint?: string;
  runtimeControlPlanePollMs?: number;
  traceDir?: string;
}

export interface FrameRecord {
  ts: string;
  sessionId: string;
  tenantId?: string;
  metricsOnly?: boolean;
  direction: Direction;
  bytesRaw: number;
  bytesSent: number;
  batchedCount: number;
  compressed: boolean;
  delta: boolean;
  queueDelayMs: number;
  latencyMs?: number;
  loopTurnMs?: number;
  toolRoundtripMs?: number;
  framesPerTurn?: number;
  note?: string;
  signal?:
    | "queue-overflow"
    | "backpressure"
    | "tenant-breaker-open"
    | "session-rollback"
    | "policy-denied"
    | "rate-limit-denied"
    | "auth-rejected"
    | "authz-denied";
}

export interface TenantAggregateMetrics {
  totalFramesRaw: number;
  totalFramesSent: number;
  totalBytesRaw: number;
  totalBytesSent: number;
  latencySamples: number;
  latencyMsTotal: number;
  loopTurnSamples: number;
  loopTurnMsTotal: number;
  toolRoundtripSamples: number;
  toolRoundtripMsTotal: number;
  framesPerTurnSamples: number;
  framesPerTurnTotal: number;
  queueDelaySamples: number;
  queueDelayMsTotal: number;
  queueOverflowEvents: number;
  backpressureEvents: number;
  tenantBreakerOpenEvents: number;
  sessionRollbackEvents: number;
  policyDeniedEvents: number;
  rateLimitDeniedEvents: number;
  authRejectedEvents: number;
  authzDeniedEvents: number;
}

export interface AggregateMetrics {
  totalFramesRaw: number;
  totalFramesSent: number;
  totalBytesRaw: number;
