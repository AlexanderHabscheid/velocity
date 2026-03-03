#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { runBench, runBenchCi } from "./bench";
import { MetricsStore } from "./metrics-store";
import { startProxy } from "./proxy";
import { replayTrace } from "./replay";
import { printStatsWithOptions } from "./stats";
import { startControlPlaneWithOptions } from "./control-plane";
import { runDoctor } from "./doctor";
import { runBootstrap } from "./bootstrap";

type PerformanceProfile = "balanced" | "low-latency" | "high-throughput";
type OptionValue = string | boolean;

const PROFILE_OVERRIDES: Record<PerformanceProfile, Record<string, OptionValue>> = {
  balanced: {},
  "low-latency": {
    batchWindowMs: "1",
    minBatchWindowMs: "0",
    maxBatchWindowMs: "4",
    latencyBudgetMs: "15",
    batchMaxMessages: "24",
    batchMaxBytes: "65536",
    zstd: false,
    delta: false,
    safeMode: true,
  },
  "high-throughput": {
    batchWindowMs: "15",
    minBatchWindowMs: "2",
    maxBatchWindowMs: "30",
    latencyBudgetMs: "100",
    batchMaxMessages: "256",
    batchMaxBytes: "262144",
    zstd: true,
    delta: true,
    safeMode: false,
  },
};

function resolvePerformanceProfile(raw: string): PerformanceProfile {
  if (raw === "low-latency" || raw === "balanced" || raw === "high-throughput") {
    return raw;
  }
  throw new Error(`invalid --performance-profile: ${raw} (expected one of low-latency|balanced|high-throughput)`);
}

function applyPerformanceProfile(
  rawOptions: Record<string, OptionValue>,
  command: Command,
  profile: PerformanceProfile,
): void {
  const overrides = PROFILE_OVERRIDES[profile];
  for (const [key, value] of Object.entries(overrides)) {
    if (command.getOptionValueSource(key) === "default") {
      rawOptions[key] = value;
    }
  }
}

function parseTargetPool(target: string, poolCsv: string): string[] {
  const extra = poolCsv.split(",").map((x) => x.trim()).filter(Boolean);
  return [...new Set([target, ...extra])];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const program = new Command();

program
  .name("velocity")
  .description("WebSocket multiplexer and batching layer")
  .version("0.1.0");

program
  .command("proxy")
  .requiredOption("--target <url>", "target WebSocket URL")
  .option("--host <host>", "proxy listen host", "127.0.0.1")
  .option("--port <number>", "proxy listen port", "4100")
  .option("--listener-engine <engine>", "listener engine: ws or uwebsockets", "ws")
  .option("--ingress-h2h3-pilot", "enable forwarded h2/h3 ingress pilot checks", false)
  .option("--batch-window-ms <number>", "batching window in ms", "10")
  .option("--batch-max-messages <number>", "max logical messages per flush before immediate send", "64")
  .option("--batch-max-bytes <number>", "max logical payload bytes per flush before immediate send", "131072")
  .option("--min-batch-window-ms <number>", "adaptive minimum batch window", "0")
  .option("--max-batch-window-ms <number>", "adaptive maximum batch window", "20")
  .option("--latency-budget-ms <number>", "target p95 latency budget for adaptive batching", "40")
  .option("--zstd", "enable zstd compression", false)
  .option("--zstd-min-bytes <number>", "minimum encoded envelope bytes before compression is attempted", "512")
  .option("--zstd-min-gain-ratio <number>", "minimum required size reduction ratio before compression is kept", "0.03")
  .option("--zstd-dictionary", "enable experimental zstd dictionary compression path", false)
  .option("--zstd-dictionary-base64 <b64>", "base64 dictionary blob for zstd dictionary mode", "")
  .option("--zstd-dictionary-min-bytes <number>", "minimum payload size before dictionary compression is attempted", "1024")
  .option("--protobuf", "enable experimental protobuf envelope encoding", false)
  .option("--delta", "enable delta-only response sideband", false)
  .option("--structured-delta-types <list>", "comma-separated message types eligible for structured delta", "")
  .option("--no-auto-fallback", "disable adaptive fallback when batching regresses")
  .option("--no-negotiate", "disable velocity capability handshake")
  .option("--negotiation-timeout-ms <number>", "capability handshake timeout", "25")
  .option("--no-passthrough-merge", "disable JSON-RPC passthrough batch merge")
  .option("--safe-mode", "enable conservative runtime safety defaults", false)
  .option("--breaker-threshold <number>", "hard-guard breach count before tenant breaker opens", "3")
  .option("--breaker-window-ms <number>", "tenant breaker counting window", "30000")
  .option("--breaker-cooldown-ms <number>", "tenant breaker open duration", "60000")
  .option("--rollback-breach-threshold <number>", "session breaches before rollback to passthrough", "3")
  .option("--rollback-window-ms <number>", "session rollback counting window", "15000")
  .option("--max-inbound-queue <number>", "max queued agent frames per session before protective close", "4096")
  .option("--max-outstanding-batches <number>", "max tracked outbound batches before trimming oldest", "8192")
  .option("--max-socket-backpressure-bytes <number>", "ws bufferedAmount threshold for backpressure actions", "4194304")
  .option("--listener-max-payload-bytes <number>", "max accepted inbound frame size for listener engines", "104857600")
  .option("--upstream-handshake-timeout-ms <number>", "upstream websocket handshake timeout in ms", "10000")
  .option("--upstream-max-payload-bytes <number>", "max accepted upstream frame size", "104857600")
  .option("--upstream-per-message-deflate", "enable upstream permessage-deflate negotiation", true)
  .option("--heartbeat-interval-ms <number>", "websocket ping interval in milliseconds (0 disables)", "25000")
  .option("--heartbeat-timeout-ms <number>", "allowed missed pong time before session close", "10000")
  .option("--target-pool <list>", "comma-separated upstream target URLs for EWMA routing", "")
  .option("--target-pool-ewma-alpha <number>", "EWMA alpha for upstream latency scoring", "0.2")
  .option("--target-pool-eject-failures <number>", "consecutive failures before temporary target ejection", "3")
  .option("--target-pool-eject-ms <number>", "target ejection duration in ms", "30000")
  .option("--target-pool-probe-interval-ms <number>", "active probe interval in ms (0 disables)", "5000")
  .option("--target-pool-probe-timeout-ms <number>", "active probe timeout in ms", "1500")
  .option("--performance-profile <profile>", "batching preset: low-latency|balanced|high-throughput", "balanced")
  .option("--log-format <format>", "log output format: text or json", "text")
  .option("--otlp-http-endpoint <url>", "optional OTLP HTTP collector base URL", "")
  .option("--otlp-interval-ms <number>", "OTLP export interval in milliseconds", "10000")
  .option("--otlp-service-name <name>", "OTLP service.name value", "velocity-proxy")
  .option("--metrics-host <host>", "metrics endpoint bind host", "127.0.0.1")
  .option("--metrics-port <number>", "metrics endpoint port (0 disables)", "0")
  .option("--state-dir <path>", "directory for metrics + traces", path.resolve(process.cwd(), ".velocity"))
  .option("--runtime-control-plane-endpoint <url>", "optional control-plane endpoint for hot runtime tuning", "")
  .option("--runtime-control-plane-poll-ms <number>", "runtime tuning poll interval in milliseconds", "5000")
  .option("--opa-endpoint <url>", "OPA base URL for tenant policy checks", "")
  .option("--opa-path <path>", "OPA data path, e.g. velocity/allow", "velocity/allow")
  .option("--opa-timeout-ms <number>", "OPA request timeout in milliseconds", "250")
  .option("--policy-fail-open", "allow traffic when OPA check fails", false)
  .option("--rate-limit-control-plane-endpoint <url>", "optional control-plane endpoint for distributed rate-limit checks", "")
  .option("--rate-limit-timeout-ms <number>", "distributed rate-limit timeout in milliseconds", "250")
  .option("--rate-limit-fail-open", "allow traffic when distributed rate-limit backend is unavailable", false)
  .option("--jwt-required", "require Authorization: Bearer token", false)
  .option("--jwt-jwks-url <url>", "JWKS URL for JWT verification", "")
  .option("--jwt-issuer <issuer>", "required JWT issuer", "")
  .option("--jwt-audience <audience>", "required JWT audience", "")
  .option("--openfga-endpoint <url>", "optional OpenFGA API base URL", "")
  .option("--openfga-store-id <id>", "OpenFGA store ID", "")
  .option("--openfga-model-id <id>", "OpenFGA authorization model ID", "")
  .option("--openfga-relation <relation>", "OpenFGA relation to check", "connect")
  .option("--openfga-object-prefix <prefix>", "OpenFGA object prefix", "tenant:")
  .option("--openfga-user-claim <claim>", "JWT claim name to map to OpenFGA user", "sub")
  .option("--openfga-fail-open", "allow traffic when OpenFGA check errors", false)
  .option("--openfga-token <token>", "optional OpenFGA API bearer token", "")
  .option("--openfga-timeout-ms <number>", "OpenFGA check timeout in milliseconds", "250")
  .option("--nats-url <url>", "optional NATS URL for runtime event publishing", "")
  .option("--event-subject-prefix <prefix>", "NATS subject prefix for runtime events", "velocity.events")
  .action(async (opts: {
    target: string;
    host: string;
    port: string;
    listenerEngine: "ws" | "uwebsockets";
    ingressH2H3Pilot: boolean;
    batchWindowMs: string;
    batchMaxMessages: string;
    batchMaxBytes: string;
    minBatchWindowMs: string;
    maxBatchWindowMs: string;
    latencyBudgetMs: string;
    zstd: boolean;
    zstdMinBytes: string;
    zstdMinGainRatio: string;
    zstdDictionary: boolean;
    zstdDictionaryBase64: string;
    zstdDictionaryMinBytes: string;
    protobuf: boolean;
    delta: boolean;
    structuredDeltaTypes: string;
    autoFallback: boolean;
    negotiate: boolean;
    negotiationTimeoutMs: string;
    passthroughMerge: boolean;
    safeMode: boolean;
    breakerThreshold: string;
    breakerWindowMs: string;
    breakerCooldownMs: string;
    rollbackBreachThreshold: string;
    rollbackWindowMs: string;
    maxInboundQueue: string;
    maxOutstandingBatches: string;
    maxSocketBackpressureBytes: string;
    listenerMaxPayloadBytes: string;
    upstreamHandshakeTimeoutMs: string;
    upstreamMaxPayloadBytes: string;
    upstreamPerMessageDeflate: boolean;
    heartbeatIntervalMs: string;
    heartbeatTimeoutMs: string;
    targetPool: string;
    targetPoolEwmaAlpha: string;
    targetPoolEjectFailures: string;
    targetPoolEjectMs: string;
    targetPoolProbeIntervalMs: string;
    targetPoolProbeTimeoutMs: string;
    performanceProfile: string;
    logFormat: "text" | "json";
    otlpHttpEndpoint: string;
    otlpIntervalMs: string;
    otlpServiceName: string;
    metricsHost: string;
    metricsPort: string;
    stateDir: string;
    runtimeControlPlaneEndpoint: string;
    runtimeControlPlanePollMs: string;
    opaEndpoint: string;
    opaPath: string;
    opaTimeoutMs: string;
    policyFailOpen: boolean;
    rateLimitControlPlaneEndpoint: string;
    rateLimitTimeoutMs: string;
    rateLimitFailOpen: boolean;
    jwtRequired: boolean;
    jwtJwksUrl: string;
    jwtIssuer: string;
    jwtAudience: string;
    openfgaEndpoint: string;
    openfgaStoreId: string;
    openfgaModelId: string;
    openfgaRelation: string;
    openfgaObjectPrefix: string;
    openfgaUserClaim: string;
    openfgaFailOpen: boolean;
    openfgaToken: string;
    openfgaTimeoutMs: string;
    natsUrl: string;
    eventSubjectPrefix: string;
  }, command: Command) => {
    const profile = resolvePerformanceProfile(opts.performanceProfile);
    applyPerformanceProfile(opts as unknown as Record<string, OptionValue>, command, profile);
    const poolTargets = parseTargetPool(opts.target, opts.targetPool);
    await startProxy({
      target: opts.target,
      targetPool: poolTargets.length > 1
        ? {
          targets: poolTargets,
          ewmaAlpha: Number(opts.targetPoolEwmaAlpha),
          ejectFailures: Number(opts.targetPoolEjectFailures),
          ejectMs: Number(opts.targetPoolEjectMs),
          probeIntervalMs: Number(opts.targetPoolProbeIntervalMs),
          probeTimeoutMs: Number(opts.targetPoolProbeTimeoutMs),
          initialLatencyMs: 25,
          connectionPenaltyMs: 2,
          failurePenaltyMs: 75,
          unhealthyPenaltyMs: 100,
        }
        : undefined,
      listenHost: opts.host,
      listenPort: Number(opts.port),
      listenerEngine: opts.listenerEngine,
      ingressH2H3Pilot: opts.ingressH2H3Pilot,
      batchWindowMs: Number(opts.batchWindowMs),
      batchMaxMessages: Number(opts.batchMaxMessages),
      batchMaxBytes: Number(opts.batchMaxBytes),
      minBatchWindowMs: Number(opts.minBatchWindowMs),
      maxBatchWindowMs: Number(opts.maxBatchWindowMs),
      latencyBudgetMs: Number(opts.latencyBudgetMs),
      enableZstd: opts.zstd,
      zstdMinBytes: Number(opts.zstdMinBytes),
      zstdMinGainRatio: Number(opts.zstdMinGainRatio),
      enableZstdDictionary: opts.zstdDictionary,
      zstdDictionaryBase64: opts.zstdDictionaryBase64 || undefined,
      zstdDictionaryMinBytes: Number(opts.zstdDictionaryMinBytes),
      enableProtobuf: opts.protobuf,
      enableDelta: opts.delta,
      structuredDeltaTypes: opts.structuredDeltaTypes
        ? opts.structuredDeltaTypes.split(",").map((x) => x.trim()).filter(Boolean)
        : [],
      autoFallback: opts.autoFallback,
      enableNegotiation: opts.negotiate,
      negotiationTimeoutMs: Number(opts.negotiationTimeoutMs),
      enablePassthroughMerge: opts.passthroughMerge,
      safeMode: opts.safeMode,
      breakerThreshold: Number(opts.breakerThreshold),
      breakerWindowMs: Number(opts.breakerWindowMs),
      breakerCooldownMs: Number(opts.breakerCooldownMs),
      rollbackBreachThreshold: Number(opts.rollbackBreachThreshold),
      rollbackWindowMs: Number(opts.rollbackWindowMs),
      maxInboundQueue: Number(opts.maxInboundQueue),
      maxOutstandingBatches: Number(opts.maxOutstandingBatches),
      maxSocketBackpressureBytes: Number(opts.maxSocketBackpressureBytes),
      listenerMaxPayloadBytes: Number(opts.listenerMaxPayloadBytes),
      upstreamHandshakeTimeoutMs: Number(opts.upstreamHandshakeTimeoutMs),
      upstreamMaxPayloadBytes: Number(opts.upstreamMaxPayloadBytes),
      upstreamPerMessageDeflate: opts.upstreamPerMessageDeflate,
      heartbeatIntervalMs: Number(opts.heartbeatIntervalMs),
      heartbeatTimeoutMs: Number(opts.heartbeatTimeoutMs),
      logFormat: opts.logFormat,
      otlpHttpEndpoint: opts.otlpHttpEndpoint || undefined,
      otlpIntervalMs: Number(opts.otlpIntervalMs),
      otlpServiceName: opts.otlpServiceName,
      metricsHost: opts.metricsHost,
      metricsPort: Number(opts.metricsPort),
      runtimeControlPlaneEndpoint: opts.runtimeControlPlaneEndpoint || undefined,
      runtimeControlPlanePollMs: Number(opts.runtimeControlPlanePollMs),
      policy: opts.opaEndpoint
        ? {
          opaEndpoint: opts.opaEndpoint,
          opaPath: opts.opaPath,
          timeoutMs: Number(opts.opaTimeoutMs),
          failOpen: opts.policyFailOpen,
        }
        : undefined,
      rateLimit: opts.rateLimitControlPlaneEndpoint
        ? {
          controlPlaneEndpoint: opts.rateLimitControlPlaneEndpoint,
          timeoutMs: Number(opts.rateLimitTimeoutMs),
          failOpen: opts.rateLimitFailOpen,
        }
        : undefined,
      authn: opts.jwtJwksUrl
        ? {
          required: opts.jwtRequired,
          jwksUrl: opts.jwtJwksUrl,
          issuer: opts.jwtIssuer || undefined,
          audience: opts.jwtAudience || undefined,
        }
        : undefined,
      authz: opts.openfgaEndpoint && opts.openfgaStoreId
        ? {
          endpoint: opts.openfgaEndpoint,
          storeId: opts.openfgaStoreId,
          modelId: opts.openfgaModelId || undefined,
          relation: opts.openfgaRelation,
          objectPrefix: opts.openfgaObjectPrefix,
          userClaim: opts.openfgaUserClaim,
          failOpen: opts.openfgaFailOpen,
          token: opts.openfgaToken || undefined,
          timeoutMs: Number(opts.openfgaTimeoutMs),
        }
        : undefined,
      eventBus: opts.natsUrl
        ? {
          natsUrl: opts.natsUrl,
          subjectPrefix: opts.eventSubjectPrefix,
        }
        : undefined,
      traceDir: opts.stateDir,
    });
  });

program
  .command("canary")
  .requiredOption("--target <url>", "target WebSocket URL")
  .option("--host <host>", "proxy listen host", "127.0.0.1")
  .option("--port <number>", "proxy listen port", "4100")
  .option("--listener-engine <engine>", "listener engine: ws or uwebsockets", "ws")
  .option("--ingress-h2h3-pilot", "enable forwarded h2/h3 ingress pilot checks", false)
  .option("--batch-window-ms <number>", "batching window in ms", "10")
  .option("--batch-max-messages <number>", "max logical messages per flush before immediate send", "64")
  .option("--batch-max-bytes <number>", "max logical payload bytes per flush before immediate send", "131072")
  .option("--min-batch-window-ms <number>", "adaptive minimum batch window", "0")
  .option("--max-batch-window-ms <number>", "adaptive maximum batch window", "20")
  .option("--latency-budget-ms <number>", "target p95 latency budget for adaptive batching", "40")
  .option("--zstd", "enable zstd compression", false)
  .option("--zstd-min-bytes <number>", "minimum encoded envelope bytes before compression is attempted", "512")
  .option("--zstd-min-gain-ratio <number>", "minimum required size reduction ratio before compression is kept", "0.03")
  .option("--zstd-dictionary", "enable experimental zstd dictionary compression path", false)
  .option("--zstd-dictionary-base64 <b64>", "base64 dictionary blob for zstd dictionary mode", "")
  .option("--zstd-dictionary-min-bytes <number>", "minimum payload size before dictionary compression is attempted", "1024")
  .option("--protobuf", "enable experimental protobuf envelope encoding", false)
  .option("--delta", "enable delta-only response sideband", false)
  .option("--structured-delta-types <list>", "comma-separated message types eligible for structured delta", "")
  .option("--no-auto-fallback", "disable adaptive fallback when batching regresses")
  .option("--no-negotiate", "disable velocity capability handshake")
  .option("--negotiation-timeout-ms <number>", "capability handshake timeout", "25")
  .option("--no-passthrough-merge", "disable JSON-RPC passthrough batch merge")
  .option("--safe-mode", "force all tenants to safe mode", false)
  .option("--canary-percent <number>", "percent of tenants in safe-mode canary cohort", "25")
  .option("--promotion-window-ms <number>", "clean runtime window before auto-promotion", "900000")
  .option("--min-sessions <number>", "minimum sessions before tenant promotion", "50")
  .option("--canary-state-file <path>", "persistent canary state file", path.resolve(process.cwd(), ".velocity/canary-state.json"))
  .option("--breaker-threshold <number>", "hard-guard breach count before tenant breaker opens", "3")
  .option("--breaker-window-ms <number>", "tenant breaker counting window", "30000")
  .option("--breaker-cooldown-ms <number>", "tenant breaker open duration", "60000")
  .option("--rollback-breach-threshold <number>", "session breaches before rollback to passthrough", "3")
  .option("--rollback-window-ms <number>", "session rollback counting window", "15000")
  .option("--max-inbound-queue <number>", "max queued agent frames per session before protective close", "4096")
  .option("--max-outstanding-batches <number>", "max tracked outbound batches before trimming oldest", "8192")
  .option("--max-socket-backpressure-bytes <number>", "ws bufferedAmount threshold for backpressure actions", "4194304")
  .option("--listener-max-payload-bytes <number>", "max accepted inbound frame size for listener engines", "104857600")
  .option("--upstream-handshake-timeout-ms <number>", "upstream websocket handshake timeout in ms", "10000")
  .option("--upstream-max-payload-bytes <number>", "max accepted upstream frame size", "104857600")
  .option("--upstream-per-message-deflate", "enable upstream permessage-deflate negotiation", true)
  .option("--heartbeat-interval-ms <number>", "websocket ping interval in milliseconds (0 disables)", "25000")
  .option("--heartbeat-timeout-ms <number>", "allowed missed pong time before session close", "10000")
  .option("--target-pool <list>", "comma-separated upstream target URLs for EWMA routing", "")
  .option("--target-pool-ewma-alpha <number>", "EWMA alpha for upstream latency scoring", "0.2")
  .option("--target-pool-eject-failures <number>", "consecutive failures before temporary target ejection", "3")
  .option("--target-pool-eject-ms <number>", "target ejection duration in ms", "30000")
  .option("--target-pool-probe-interval-ms <number>", "active probe interval in ms (0 disables)", "5000")
  .option("--target-pool-probe-timeout-ms <number>", "active probe timeout in ms", "1500")
  .option("--performance-profile <profile>", "batching preset: low-latency|balanced|high-throughput", "balanced")
  .option("--log-format <format>", "log output format: text or json", "text")
  .option("--otlp-http-endpoint <url>", "optional OTLP HTTP collector base URL", "")
  .option("--otlp-interval-ms <number>", "OTLP export interval in milliseconds", "10000")
  .option("--otlp-service-name <name>", "OTLP service.name value", "velocity-proxy")
  .option("--metrics-host <host>", "metrics endpoint bind host", "127.0.0.1")
  .option("--metrics-port <number>", "metrics endpoint port (0 disables)", "0")
  .option("--state-dir <path>", "directory for metrics + traces", path.resolve(process.cwd(), ".velocity"))
  .option("--runtime-control-plane-endpoint <url>", "optional control-plane endpoint for hot runtime tuning", "")
  .option("--runtime-control-plane-poll-ms <number>", "runtime tuning poll interval in milliseconds", "5000")
  .option("--opa-endpoint <url>", "OPA base URL for tenant policy checks", "")
  .option("--opa-path <path>", "OPA data path, e.g. velocity/allow", "velocity/allow")
  .option("--opa-timeout-ms <number>", "OPA request timeout in milliseconds", "250")
  .option("--policy-fail-open", "allow traffic when OPA check fails", false)
  .option("--rate-limit-control-plane-endpoint <url>", "optional control-plane endpoint for distributed rate-limit checks", "")
  .option("--rate-limit-timeout-ms <number>", "distributed rate-limit timeout in milliseconds", "250")
  .option("--rate-limit-fail-open", "allow traffic when distributed rate-limit backend is unavailable", false)
  .option("--jwt-required", "require Authorization: Bearer token", false)
  .option("--jwt-jwks-url <url>", "JWKS URL for JWT verification", "")
  .option("--jwt-issuer <issuer>", "required JWT issuer", "")
  .option("--jwt-audience <audience>", "required JWT audience", "")
  .option("--openfga-endpoint <url>", "optional OpenFGA API base URL", "")
  .option("--openfga-store-id <id>", "OpenFGA store ID", "")
  .option("--openfga-model-id <id>", "OpenFGA authorization model ID", "")
  .option("--openfga-relation <relation>", "OpenFGA relation to check", "connect")
  .option("--openfga-object-prefix <prefix>", "OpenFGA object prefix", "tenant:")
  .option("--openfga-user-claim <claim>", "JWT claim name to map to OpenFGA user", "sub")
  .option("--openfga-fail-open", "allow traffic when OpenFGA check errors", false)
  .option("--openfga-token <token>", "optional OpenFGA API bearer token", "")
  .option("--openfga-timeout-ms <number>", "OpenFGA check timeout in milliseconds", "250")
  .option("--nats-url <url>", "optional NATS URL for runtime event publishing", "")
  .option("--event-subject-prefix <prefix>", "NATS subject prefix for runtime events", "velocity.events")
  .action(async (opts: {
    target: string;
    host: string;
    port: string;
    listenerEngine: "ws" | "uwebsockets";
    ingressH2H3Pilot: boolean;
    batchWindowMs: string;
    batchMaxMessages: string;
    batchMaxBytes: string;
    minBatchWindowMs: string;
    maxBatchWindowMs: string;
    latencyBudgetMs: string;
    zstd: boolean;
    zstdMinBytes: string;
    zstdMinGainRatio: string;
    zstdDictionary: boolean;
    zstdDictionaryBase64: string;
    zstdDictionaryMinBytes: string;
    protobuf: boolean;
    delta: boolean;
    structuredDeltaTypes: string;
    autoFallback: boolean;
    negotiate: boolean;
    negotiationTimeoutMs: string;
    passthroughMerge: boolean;
    safeMode: boolean;
    canaryPercent: string;
    promotionWindowMs: string;
    minSessions: string;
    canaryStateFile: string;
    breakerThreshold: string;
    breakerWindowMs: string;
    breakerCooldownMs: string;
    rollbackBreachThreshold: string;
    rollbackWindowMs: string;
    maxInboundQueue: string;
    maxOutstandingBatches: string;
    maxSocketBackpressureBytes: string;
    listenerMaxPayloadBytes: string;
    upstreamHandshakeTimeoutMs: string;
    upstreamMaxPayloadBytes: string;
    upstreamPerMessageDeflate: boolean;
    heartbeatIntervalMs: string;
    heartbeatTimeoutMs: string;
    targetPool: string;
    targetPoolEwmaAlpha: string;
    targetPoolEjectFailures: string;
    targetPoolEjectMs: string;
    targetPoolProbeIntervalMs: string;
    targetPoolProbeTimeoutMs: string;
    performanceProfile: string;
    logFormat: "text" | "json";
    otlpHttpEndpoint: string;
    otlpIntervalMs: string;
    otlpServiceName: string;
    metricsHost: string;
    metricsPort: string;
    stateDir: string;
    runtimeControlPlaneEndpoint: string;
    runtimeControlPlanePollMs: string;
    opaEndpoint: string;
    opaPath: string;
    opaTimeoutMs: string;
    policyFailOpen: boolean;
    rateLimitControlPlaneEndpoint: string;
    rateLimitTimeoutMs: string;
    rateLimitFailOpen: boolean;
    jwtRequired: boolean;
    jwtJwksUrl: string;
    jwtIssuer: string;
    jwtAudience: string;
    openfgaEndpoint: string;
    openfgaStoreId: string;
    openfgaModelId: string;
    openfgaRelation: string;
    openfgaObjectPrefix: string;
    openfgaUserClaim: string;
    openfgaFailOpen: boolean;
    openfgaToken: string;
    openfgaTimeoutMs: string;
    natsUrl: string;
    eventSubjectPrefix: string;
  }, command: Command) => {
    const profile = resolvePerformanceProfile(opts.performanceProfile);
    applyPerformanceProfile(opts as unknown as Record<string, OptionValue>, command, profile);
    const poolTargets = parseTargetPool(opts.target, opts.targetPool);
    await startProxy({
      target: opts.target,
      targetPool: poolTargets.length > 1
        ? {
          targets: poolTargets,
          ewmaAlpha: Number(opts.targetPoolEwmaAlpha),
          ejectFailures: Number(opts.targetPoolEjectFailures),
          ejectMs: Number(opts.targetPoolEjectMs),
          probeIntervalMs: Number(opts.targetPoolProbeIntervalMs),
          probeTimeoutMs: Number(opts.targetPoolProbeTimeoutMs),
          initialLatencyMs: 25,
          connectionPenaltyMs: 2,
          failurePenaltyMs: 75,
          unhealthyPenaltyMs: 100,
        }
        : undefined,
      listenHost: opts.host,
      listenPort: Number(opts.port),
      listenerEngine: opts.listenerEngine,
      ingressH2H3Pilot: opts.ingressH2H3Pilot,
      batchWindowMs: Number(opts.batchWindowMs),
      batchMaxMessages: Number(opts.batchMaxMessages),
      batchMaxBytes: Number(opts.batchMaxBytes),
      minBatchWindowMs: Number(opts.minBatchWindowMs),
      maxBatchWindowMs: Number(opts.maxBatchWindowMs),
      latencyBudgetMs: Number(opts.latencyBudgetMs),
      enableZstd: opts.zstd,
      zstdMinBytes: Number(opts.zstdMinBytes),
      zstdMinGainRatio: Number(opts.zstdMinGainRatio),
      enableZstdDictionary: opts.zstdDictionary,
      zstdDictionaryBase64: opts.zstdDictionaryBase64 || undefined,
      zstdDictionaryMinBytes: Number(opts.zstdDictionaryMinBytes),
      enableProtobuf: opts.protobuf,
      enableDelta: opts.delta,
      structuredDeltaTypes: opts.structuredDeltaTypes
        ? opts.structuredDeltaTypes.split(",").map((x) => x.trim()).filter(Boolean)
        : [],
      autoFallback: opts.autoFallback,
      enableNegotiation: opts.negotiate,
      negotiationTimeoutMs: Number(opts.negotiationTimeoutMs),
      enablePassthroughMerge: opts.passthroughMerge,
      safeMode: opts.safeMode,
      canary: {
        percent: Number(opts.canaryPercent),
        promotionWindowMs: Number(opts.promotionWindowMs),
        minSessions: Number(opts.minSessions),
        stateFile: opts.canaryStateFile,
      },
      breakerThreshold: Number(opts.breakerThreshold),
      breakerWindowMs: Number(opts.breakerWindowMs),
      breakerCooldownMs: Number(opts.breakerCooldownMs),
      rollbackBreachThreshold: Number(opts.rollbackBreachThreshold),
      rollbackWindowMs: Number(opts.rollbackWindowMs),
      maxInboundQueue: Number(opts.maxInboundQueue),
      maxOutstandingBatches: Number(opts.maxOutstandingBatches),
      maxSocketBackpressureBytes: Number(opts.maxSocketBackpressureBytes),
      listenerMaxPayloadBytes: Number(opts.listenerMaxPayloadBytes),
      upstreamHandshakeTimeoutMs: Number(opts.upstreamHandshakeTimeoutMs),
      upstreamMaxPayloadBytes: Number(opts.upstreamMaxPayloadBytes),
      upstreamPerMessageDeflate: opts.upstreamPerMessageDeflate,
      heartbeatIntervalMs: Number(opts.heartbeatIntervalMs),
      heartbeatTimeoutMs: Number(opts.heartbeatTimeoutMs),
      logFormat: opts.logFormat,
      otlpHttpEndpoint: opts.otlpHttpEndpoint || undefined,
      otlpIntervalMs: Number(opts.otlpIntervalMs),
      otlpServiceName: opts.otlpServiceName,
      metricsHost: opts.metricsHost,
      metricsPort: Number(opts.metricsPort),
      runtimeControlPlaneEndpoint: opts.runtimeControlPlaneEndpoint || undefined,
      runtimeControlPlanePollMs: Number(opts.runtimeControlPlanePollMs),
      policy: opts.opaEndpoint
        ? {
          opaEndpoint: opts.opaEndpoint,
          opaPath: opts.opaPath,
          timeoutMs: Number(opts.opaTimeoutMs),
          failOpen: opts.policyFailOpen,
        }
        : undefined,
      rateLimit: opts.rateLimitControlPlaneEndpoint
        ? {
          controlPlaneEndpoint: opts.rateLimitControlPlaneEndpoint,
          timeoutMs: Number(opts.rateLimitTimeoutMs),
          failOpen: opts.rateLimitFailOpen,
        }
        : undefined,
      authn: opts.jwtJwksUrl
        ? {
          required: opts.jwtRequired,
          jwksUrl: opts.jwtJwksUrl,
          issuer: opts.jwtIssuer || undefined,
          audience: opts.jwtAudience || undefined,
        }
        : undefined,
      authz: opts.openfgaEndpoint && opts.openfgaStoreId
        ? {
          endpoint: opts.openfgaEndpoint,
          storeId: opts.openfgaStoreId,
          modelId: opts.openfgaModelId || undefined,
          relation: opts.openfgaRelation,
          objectPrefix: opts.openfgaObjectPrefix,
          userClaim: opts.openfgaUserClaim,
          failOpen: opts.openfgaFailOpen,
          token: opts.openfgaToken || undefined,
          timeoutMs: Number(opts.openfgaTimeoutMs),
        }
        : undefined,
      eventBus: opts.natsUrl
        ? {
          natsUrl: opts.natsUrl,
          subjectPrefix: opts.eventSubjectPrefix,
        }
        : undefined,
      traceDir: opts.stateDir,
    });
  });

program
  .command("control-plane")
  .option("--host <host>", "control-plane listen host", "127.0.0.1")
  .option("--port <number>", "control-plane listen port", "4200")
  .option("--store-engine <engine>", "control-plane persistence engine: json or sqlite", "json")
  .option("--state-file <path>", "json state file path for control-plane persistence", path.resolve(process.cwd(), ".velocity/control-plane-state.json"))
  .option("--db-path <path>", "sqlite path for durable tenant policy + rate-limit state", path.resolve(process.cwd(), ".velocity/control-plane.db"))
  .option("--valkey-url <url>", "optional Valkey/Redis URL for distributed rate-limit buckets", "")
  .option("--nats-url <url>", "optional NATS URL for control-plane event publishing", "")
  .option("--event-subject-prefix <prefix>", "NATS subject prefix for control-plane events", "velocity.events")
  .action(async (opts: {
    host: string;
    port: string;
    storeEngine: "json" | "sqlite";
    stateFile: string;
    dbPath: string;
    valkeyUrl: string;
    natsUrl: string;
    eventSubjectPrefix: string;
  }) => {
    await startControlPlaneWithOptions({
      host: opts.host,
      port: Number(opts.port),
      storeEngine: opts.storeEngine,
      stateFile: opts.stateFile,
      dbPath: opts.dbPath,
      valkeyUrl: opts.valkeyUrl || undefined,
      natsUrl: opts.natsUrl || undefined,
      eventSubjectPrefix: opts.eventSubjectPrefix,
    });
  });

program
  .command("doctor")
  .option("--infra", "also check docker and kubectl infrastructure prerequisites", false)
  .action((opts: { infra: boolean }) => {
    const result = runDoctor({ infra: opts.infra });
    if (!result.ok) {
      process.exitCode = 1;
    }
  });

program
  .command("bootstrap")
  .option("--out-dir <path>", "directory where velocity template files are written", ".")
  .option("--force", "overwrite existing velocity bootstrap files", false)
  .action((opts: { outDir: string; force: boolean }) => {
    runBootstrap({
      outDir: opts.outDir,
      force: opts.force,
    });
  });

program
  .command("bench")
  .option("--messages <number>", "number of logical request/response pairs", "600")
  .option("--burst <number>", "logical ops sent back-to-back each tick", "8")
  .option("--payload-bytes <number>", "payload size per message in bytes", "512")
  .option("--batch-window-ms <number>", "batch window for proxied trial", "10")
  .option("--min-batch-window-ms <number>", "adaptive minimum batch window", "0")
  .option("--max-batch-window-ms <number>", "adaptive maximum batch window", "20")
  .option("--latency-budget-ms <number>", "target p95 latency budget", "40")
  .option("--server-delay-ms <number>", "simulated upstream processing delay", "2")
  .option("--jitter-ms <number>", "simulated random upstream jitter", "0")
  .option("--max-p95-delta-ms <number>", "pass threshold for p95 latency delta in milliseconds", "8")
  .option("--max-avg-delta-ms <number>", "pass threshold for avg latency delta in milliseconds", "6")
  .option("--min-frame-reduction-pct <number>", "pass threshold for frame reduction percent", "10")
  .option("--min-byte-reduction-pct <number>", "pass threshold for byte reduction percent", "85")
  .action(async (opts: {
    messages: string;
    burst: string;
    payloadBytes: string;
    batchWindowMs: string;
    minBatchWindowMs: string;
    maxBatchWindowMs: string;
    latencyBudgetMs: string;
    serverDelayMs: string;
    jitterMs: string;
    maxP95DeltaMs: string;
    maxAvgDeltaMs: string;
    minFrameReductionPct: string;
    minByteReductionPct: string;
  }) => {
    await runBench({
      messages: Number(opts.messages),
      burst: Number(opts.burst),
      payloadBytes: Number(opts.payloadBytes),
      batchWindowMs: Number(opts.batchWindowMs),
      minBatchWindowMs: Number(opts.minBatchWindowMs),
      maxBatchWindowMs: Number(opts.maxBatchWindowMs),
      latencyBudgetMs: Number(opts.latencyBudgetMs),
      serverDelayMs: Number(opts.serverDelayMs),
      jitterMs: Number(opts.jitterMs),
      maxP95DeltaMs: Number(opts.maxP95DeltaMs),
      maxAvgDeltaMs: Number(opts.maxAvgDeltaMs),
      minFrameReductionPct: Number(opts.minFrameReductionPct),
      minByteReductionPct: Number(opts.minByteReductionPct),
    });
  });

program
  .command("bench-ci")
  .option("--out-dir <path>", "report output directory", path.resolve(process.cwd(), ".velocity/bench-reports"))
  .option("--profiles <list>", "comma-separated profiles or all", "all")
  .option("--repeats <number>", "runs per profile for median aggregation", "3")
  .option("--seed <number>", "base seed for deterministic benchmark jitter", "42")
  .option("--baseline-report <path>", "optional prior bench report for certification-style regression checks")
  .option("--max-p95-regression-pct <number>", "allowed p95-delta regression vs baseline report", "10")
  .option("--max-p95-regression-ms-floor <number>", "minimum absolute p95-delta slack (ms) vs baseline report", "2")
  .option("--max-byte-reduction-drop-pct <number>", "allowed byte-reduction drop vs baseline report", "5")
  .option("--fail-on-regression", "exit non-zero when latency/throughput regression gates fail", false)
  .action(async (opts: {
    outDir: string;
    profiles: string;
    repeats: string;
    seed: string;
    baselineReport?: string;
    maxP95RegressionPct: string;
    maxP95RegressionMsFloor: string;
    maxByteReductionDropPct: string;
    failOnRegression: boolean;
  }) => {
    await runBenchCi({
      outDir: opts.outDir,
      profiles: opts.profiles,
      repeats: Number(opts.repeats),
      seed: Number(opts.seed),
      baselineReport: opts.baselineReport || undefined,
      maxP95RegressionPct: Number(opts.maxP95RegressionPct),
      maxP95RegressionMsFloor: Number(opts.maxP95RegressionMsFloor),
      maxByteReductionDropPct: Number(opts.maxByteReductionDropPct),
      failOnRegression: opts.failOnRegression,
    });
  });

program
  .command("stats")
  .option("--state-dir <path>", "directory for metrics + traces", path.resolve(process.cwd(), ".velocity"))
  .option("--json", "emit machine-readable stats json", false)
  .option("--verbose", "include recent trace files and extra diagnostics", false)
  .option("--watch", "refresh continuously in terminal view", false)
  .option("--interval-ms <number>", "watch refresh interval in milliseconds", "1000")
  .option("--tenant-limit <number>", "number of tenants to include in tenant breakdown", "10")
  .action(async (opts: {
    stateDir: string;
    json: boolean;
    verbose: boolean;
    watch: boolean;
    intervalMs: string;
    tenantLimit: string;
  }) => {
    const store = new MetricsStore(opts.stateDir);
    const tenantLimit = Math.max(1, Number(opts.tenantLimit));
    const render = () =>
      printStatsWithOptions(store, {
        json: opts.json,
        verbose: opts.verbose,
        tenantLimit,
      });

    if (!opts.watch) {
      render();
      return;
    }
    if (opts.json) {
      throw new Error("--watch is not compatible with --json");
    }

    const intervalMs = Math.max(250, Number(opts.intervalMs));
    let stop = false;
    const onSignal = () => {
      stop = true;
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    try {
      while (!stop) {
        process.stdout.write("\x1bc");
        render();
        console.log("");
        console.log(`watching... refresh=${intervalMs}ms (Ctrl+C to exit)`);
        await sleep(intervalMs);
      }
    } finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
  });

program
  .command("replay")
  .argument("<trace>", "trace file path")
  .action((trace: string) => {
    replayTrace(trace);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`velocity failed: ${msg}`);
  process.exitCode = 1;
});
