export interface LatencyGuardOptions {
  latencyBudgetMs: number;
  breachFactor: number;
  recoveryFactor: number;
  minSamples: number;
  cooldownMs: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

export class LatencyGuard {
  private readonly budgetMs: number;
  private readonly breachFactor: number;
  private readonly recoveryFactor: number;
  private readonly minSamples: number;
  private readonly cooldownMs: number;
  private readonly samples: number[] = [];
  private guardedUntil = 0;

  constructor(options: LatencyGuardOptions) {
    this.budgetMs = options.latencyBudgetMs;
    this.breachFactor = options.breachFactor;
    this.recoveryFactor = options.recoveryFactor;
    this.minSamples = options.minSamples;
    this.cooldownMs = options.cooldownMs;
  }

  record(latencyMs: number): { changed: boolean; guarded: boolean; p95: number } {
    const prev = this.isGuarded();
    this.samples.push(latencyMs);
    if (this.samples.length > 256) {
      this.samples.splice(0, this.samples.length - 256);
    }
