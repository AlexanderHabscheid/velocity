export interface AdaptiveBatchOptions {
  initialWindowMs: number;
  minWindowMs: number;
  maxWindowMs: number;
  latencyBudgetMs: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

export class AdaptiveBatchController {
  private windowMs: number;
  private readonly minWindowMs: number;
  private readonly maxWindowMs: number;
  private readonly latencyBudgetMs: number;
  private readonly rttMsWindow: number[] = [];
  private bypassUntil = 0;

  constructor(options: AdaptiveBatchOptions) {
    this.windowMs = Math.max(options.minWindowMs, Math.min(options.maxWindowMs, options.initialWindowMs));
    this.minWindowMs = options.minWindowMs;
    this.maxWindowMs = options.maxWindowMs;
    this.latencyBudgetMs = options.latencyBudgetMs;
  }

  onOutbound(queueDelayMs: number, count: number): void {
    if (count > 1 && queueDelayMs > this.latencyBudgetMs * 0.4) {
      this.bypassUntil = Date.now() + 1500;
    }
  }

  onInbound(rttMs: number): void {
    this.rttMsWindow.push(rttMs);
    if (this.rttMsWindow.length > 200) {
      this.rttMsWindow.splice(0, this.rttMsWindow.length - 200);
    }

    const p95 = percentile(this.rttMsWindow, 0.95);
    if (p95 > this.latencyBudgetMs) {
      this.windowMs = Math.max(this.minWindowMs, this.windowMs - 1);
      this.bypassUntil = Date.now() + 1000;
      return;
    }

    if (p95 > 0 && p95 < this.latencyBudgetMs * 0.6) {
      this.windowMs = Math.min(this.maxWindowMs, this.windowMs + 1);
    }
  }

  shouldBypassBatching(): boolean {
    return Date.now() < this.bypassUntil;
  }

  currentWindowMs(): number {
    if (this.shouldBypassBatching()) {
      return 0;
    }
    return this.windowMs;
  }

  snapshot(): { windowMs: number; bypassing: boolean } {
