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

    const p95 = percentile(this.samples, 0.95);
    if (this.samples.length >= this.minSamples && p95 > this.budgetMs * this.breachFactor) {
      this.guardedUntil = Date.now() + this.cooldownMs;
    }

    if (
      this.samples.length >= this.minSamples &&
      p95 <= this.budgetMs * this.recoveryFactor &&
      Date.now() >= this.guardedUntil
    ) {
      this.guardedUntil = 0;
    }

    const next = this.isGuarded();
    return { changed: prev !== next, guarded: next, p95 };
  }

  isGuarded(): boolean {
    return Date.now() < this.guardedUntil;
  }
}
