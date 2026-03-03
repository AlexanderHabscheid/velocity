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
    let selected = candidates[0];
    let selectedScore = this.score(selected);
    for (let i = 1; i < candidates.length; i += 1) {
      const current = candidates[i];
      const score = this.score(current);
      if (score < selectedScore) {
        selected = current;
        selectedScore = score;
      }
    }
    selected.activeConnections += 1;
    return selected.url;
  }

  releaseTarget(url: string): void {
    const state = this.states.get(url);
    if (!state) {
      return;
    }
    state.activeConnections = Math.max(0, state.activeConnections - 1);
  }

  recordLatency(url: string, latencyMs: number): void {
    const state = this.states.get(url);
    if (!state || !Number.isFinite(latencyMs) || latencyMs < 0) {
      return;
    }
    const next = state.ewmaLatencyMs === null
      ? latencyMs
      : (this.options.ewmaAlpha * latencyMs) + ((1 - this.options.ewmaAlpha) * state.ewmaLatencyMs);
    state.ewmaLatencyMs = next;
    state.healthy = true;
    state.lastSuccessAtMs = Date.now();
    state.consecutiveFailures = 0;
  }

  recordSuccess(url: string): void {
    const state = this.states.get(url);
    if (!state) {
      return;
    }
    state.healthy = true;
    state.lastSuccessAtMs = Date.now();
    state.consecutiveFailures = 0;
  }

  recordFailure(url: string, reason: string): void {
    const state = this.states.get(url);
    if (!state) {
      return;
    }
    state.healthy = false;
    state.lastFailureAtMs = Date.now();
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= this.options.ejectFailures) {
      state.ejectedUntilMs = Date.now() + this.options.ejectMs;
      this.logger.warn("velocity upstream target ejected", {
        target: url,
        reason,
        ejectedUntilMs: state.ejectedUntilMs,
        failures: state.consecutiveFailures,
      });
    }
  }

  snapshot(): Array<{
    url: string;
    activeConnections: number;
    ewmaLatencyMs: number | null;
    healthy: boolean;
    ejectedUntilMs: number;
    consecutiveFailures: number;
  }> {
    return [...this.states.values()].map((state) => ({
      url: state.url,
      activeConnections: state.activeConnections,
      ewmaLatencyMs: state.ewmaLatencyMs,
      healthy: state.healthy,
      ejectedUntilMs: state.ejectedUntilMs,
      consecutiveFailures: state.consecutiveFailures,
    }));
  }

  private score(state: UpstreamTargetState): number {
    const latency = state.ewmaLatencyMs ?? this.options.initialLatencyMs;
    const connectionPenalty = state.activeConnections * this.options.connectionPenaltyMs;
    const failurePenalty = state.consecutiveFailures * this.options.failurePenaltyMs;
    const unhealthyPenalty = state.healthy ? 0 : this.options.unhealthyPenaltyMs;
    return latency + connectionPenalty + failurePenalty + unhealthyPenalty;
  }

  private async probeTarget(url: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const socket = new WebSocket(url, {
        handshakeTimeout: this.options.probeTimeoutMs,
        perMessageDeflate: false,
      });
      let done = false;
      const finish = (ok: boolean, reason: string): void => {
        if (done) {
          return;
        }
        done = true;
        if (ok) {
          this.recordSuccess(url);
        } else {
          this.recordFailure(url, reason);
        }
        try {
          socket.close();
        } catch {
          // ignore close races
        }
        resolve();
      };
      socket.once("open", () => finish(true, "probe-open"));
      socket.once("error", (err) => finish(false, err instanceof Error ? err.message : "probe-error"));
      socket.once("close", () => finish(false, "probe-close-before-open"));
      setTimeout(() => finish(false, "probe-timeout"), this.options.probeTimeoutMs).unref();
    });
  }
}
