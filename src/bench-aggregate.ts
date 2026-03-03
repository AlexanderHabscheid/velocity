import { BenchProfile, BenchProfileResult } from "./bench-core";

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function aggregateProfileRuns(profile: BenchProfile, runs: BenchProfileResult[]): BenchProfileResult {
  if (runs.length === 0) {
    throw new Error(`no runs to aggregate for profile ${profile.name}`);
  }

  const p95DeltaMs = median(runs.map((x) => x.p95DeltaMs));
  const avgDeltaMs = median(runs.map((x) => x.avgDeltaMs));
  const frameReductionPct = median(runs.map((x) => x.frameReductionPct));
  const byteReductionPct = median(runs.map((x) => x.byteReductionPct));
  const p95DeltaPct = median(runs.map((x) => x.p95DeltaPct));
  const avgDeltaPct = median(runs.map((x) => x.avgDeltaPct));

  const pass = p95DeltaMs <= profile.maxP95DeltaMs &&
    avgDeltaMs <= profile.maxAvgDeltaMs &&
    frameReductionPct >= profile.minFrameReductionPct &&
    byteReductionPct >= profile.minByteReductionPct;

  return {
    profile,
    direct: runs[runs.length - 1].direct,
    proxied: runs[runs.length - 1].proxied,
    frameReductionPct,
    byteReductionPct,
    p95DeltaMs,
    avgDeltaMs,
    p95DeltaPct,
    avgDeltaPct,
    pass,
    stateDir: runs.map((x) => x.stateDir).join(","),
  };
}
