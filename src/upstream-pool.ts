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
        activeConnections: 0,
        ewmaLatencyMs: null,
        consecutiveFailures: 0,
        ejectedUntilMs: 0,
        healthy: true,
        lastSuccessAtMs: null,
        lastFailureAtMs: null,
      });
    }
  }

  start(): void {
    if (this.options.probeIntervalMs <= 0 || this.states.size <= 1) {
      return;
    }
    this.probeTimer = setInterval(() => {
      if (this.closed) {
        return;
      }
      for (const target of this.states.keys()) {
        void this.probeTarget(target);
      }
    }, this.options.probeIntervalMs);
    this.probeTimer.unref();
  }

  close(): void {
    this.closed = true;
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
  }

  acquireTarget(): string | null {
    const now = Date.now();
    const candidates = [...this.states.values()].filter((state) => state.ejectedUntilMs <= now);
    if (candidates.length === 0) {
      return null;
    }
