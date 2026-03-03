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
