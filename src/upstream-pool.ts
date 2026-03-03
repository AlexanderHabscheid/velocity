import WebSocket from "ws";
import { Logger } from "./logger";

interface UpstreamTargetState {
  url: string;
  activeConnections: number;
  ewmaLatencyMs: number | null;
  consecutiveFailures: number;
  ejectedUntilMs: number;
  healthy: boolean;
  lastSuccessAtMs: number | null;
  lastFailureAtMs: number | null;
}

export interface UpstreamPoolOptions {
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
}

export class UpstreamPool {
  private readonly logger: Logger;
  private readonly options: UpstreamPoolOptions;
  private readonly states = new Map<string, UpstreamTargetState>();
  private probeTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(options: UpstreamPoolOptions, logger: Logger) {
    this.logger = logger;
    this.options = options;
    for (const target of options.targets) {
      this.states.set(target, {
        url: target,
