import fs from "node:fs";
import path from "node:path";
import { MetricsStore } from "./metrics-store";

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) {
    return "0.00%";
  }
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

export function printStats(store: MetricsStore): void {
  printStatsWithOptions(store, { json: false, verbose: false, tenantLimit: 10 });
}

interface PrintStatsOptions {
  json: boolean;
  verbose: boolean;
  tenantLimit: number;
}

function safeRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function listRecentTraces(store: MetricsStore, maxItems: number): Array<{ file: string; sizeBytes: number; mtimeMs: number }> {
  return store
    .listTraces()
    .map((tracePath) => {
      const stat = fs.statSync(tracePath);
      return { file: tracePath, sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, Math.max(1, maxItems));
}

function printAdvice(items: string[]): void {
  if (items.length === 0) {
    console.log("advice:");
    console.log("  healthy profile; no immediate action suggested");
    return;
  }
  console.log("advice:");
  for (const item of items) {
    console.log(`  - ${item}`);
  }
}

function tenantFrameReduction(raw: number, sent: number): number {
  return safeRatio(raw - sent, raw);
}

export function printStatsWithOptions(store: MetricsStore, options: PrintStatsOptions): void {
  const m = store.load();
  const byteSavings = m.totalBytesRaw - m.totalBytesSent;
  const frameSavings = m.totalFramesRaw - m.totalFramesSent;
  const avgLatency = m.latencySamples > 0 ? m.latencyMsTotal / m.latencySamples : 0;
  const p95 = percentile(m.latencyMsP95Window, 0.95);
  const avgLoopTurnMs = safeRatio(m.loopTurnMsTotal, m.loopTurnSamples);
  const avgToolRoundtripMs = safeRatio(m.toolRoundtripMsTotal, m.toolRoundtripSamples);
  const avgFramesPerTurn = safeRatio(m.framesPerTurnTotal, m.framesPerTurnSamples);
  const avgQueueDelayMs = safeRatio(m.queueDelayMsTotal, m.queueDelaySamples);
  const p95QueueDelayMs = percentile(m.queueDelayMsP95Window, 0.95);
  const frameReductionRatio = safeRatio(frameSavings, m.totalFramesRaw);
  const byteReductionRatio = safeRatio(byteSavings, m.totalBytesRaw);
  const denialEvents =
    m.policyDeniedEvents + m.rateLimitDeniedEvents + m.authRejectedEvents + m.authzDeniedEvents;
  const safetyEvents =
    m.queueOverflowEvents + m.backpressureEvents + m.tenantBreakerOpenEvents + m.sessionRollbackEvents;
  const healthPenalty = denialEvents + safetyEvents;
  const topTenants = Object.entries(m.perTenant ?? {})
    .map(([tenantId, stats]) => ({
