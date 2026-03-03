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
      tenantId,
      ...stats,
      frameReductionRatio: tenantFrameReduction(stats.totalFramesRaw, stats.totalFramesSent),
      denyEvents:
        stats.policyDeniedEvents + stats.rateLimitDeniedEvents + stats.authRejectedEvents + stats.authzDeniedEvents,
      safetyEvents:
        stats.queueOverflowEvents + stats.backpressureEvents + stats.tenantBreakerOpenEvents + stats.sessionRollbackEvents,
    }))
    .sort((a, b) => b.totalFramesRaw - a.totalFramesRaw)
    .slice(0, Math.max(1, options.tenantLimit));

  if (options.json) {
    const payload = {
      updatedAt: m.updatedAt,
      frames: {
        raw: m.totalFramesRaw,
        sent: m.totalFramesSent,
        reduced: frameSavings,
        reductionRatio: frameReductionRatio,
      },
      bytes: {
        raw: m.totalBytesRaw,
        sent: m.totalBytesSent,
        saved: byteSavings,
        reductionRatio: byteReductionRatio,
      },
      latency: {
        avgMs: avgLatency,
        p95Ms: p95,
        samples: m.latencySamples,
      },
      loopKpis: {
        loopTurnAvgMs: avgLoopTurnMs,
        toolRoundtripAvgMs: avgToolRoundtripMs,
        framesPerTurnAvg: avgFramesPerTurn,
        queueDelayAvgMs: avgQueueDelayMs,
        queueDelayP95Ms: p95QueueDelayMs,
        loopTurnSamples: m.loopTurnSamples,
      },
      safetyEvents: {
        queueOverflow: m.queueOverflowEvents,
        backpressure: m.backpressureEvents,
        tenantBreakerOpen: m.tenantBreakerOpenEvents,
        sessionRollback: m.sessionRollbackEvents,
      },
      denyEvents: {
        policy: m.policyDeniedEvents,
        rateLimit: m.rateLimitDeniedEvents,
        auth: m.authRejectedEvents,
        authz: m.authzDeniedEvents,
      },
      healthPenalty,
      tenants: topTenants,
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("VELOCITY stats");
  console.log(`updated: ${m.updatedAt}`);
  console.log("");
  console.log("throughput:");
  console.log(`frames raw: ${m.totalFramesRaw}`);
  console.log(`frames sent: ${m.totalFramesSent}`);
  console.log(`frames reduced: ${frameSavings} (${pct(frameSavings, m.totalFramesRaw)})`);
  console.log(`bytes raw: ${m.totalBytesRaw}`);
  console.log(`bytes sent: ${m.totalBytesSent}`);
  console.log(`byte savings: ${byteSavings} (${pct(byteSavings, m.totalBytesRaw)})`);
  console.log(`batched frames: ${m.totalBatches} (members: ${m.totalBatchMembers})`);
  console.log(`compressed frames: ${m.totalCompressedFrames}`);
  console.log(`delta frames: ${m.totalDeltaFrames}`);
  console.log("");
  console.log("latency:");
  console.log(`samples: ${m.latencySamples}`);
  console.log(`avg: ${avgLatency.toFixed(2)}ms`);
  console.log(`p95: ${p95.toFixed(2)}ms`);
  console.log("");
  console.log("agent loop kpis:");
  console.log(`loop turn avg: ${avgLoopTurnMs.toFixed(2)}ms (${m.loopTurnSamples} samples)`);
  console.log(`tool roundtrip avg: ${avgToolRoundtripMs.toFixed(2)}ms`);
  console.log(`frames per turn avg: ${avgFramesPerTurn.toFixed(2)}`);
  console.log(`queue delay avg: ${avgQueueDelayMs.toFixed(2)}ms`);
  console.log(`queue delay p95: ${p95QueueDelayMs.toFixed(2)}ms`);
  console.log("");
  console.log("safety:");
  console.log(`queue overflow events: ${m.queueOverflowEvents}`);
  console.log(`backpressure events: ${m.backpressureEvents}`);
  console.log(`tenant breaker opens: ${m.tenantBreakerOpenEvents}`);
  console.log(`session rollbacks: ${m.sessionRollbackEvents}`);
  console.log("");
  console.log("access controls:");
  console.log(`policy denies: ${m.policyDeniedEvents}`);
  console.log(`rate-limit denies: ${m.rateLimitDeniedEvents}`);
  console.log(`auth rejects: ${m.authRejectedEvents}`);
  console.log(`authz denies: ${m.authzDeniedEvents}`);
  console.log("");
  console.log(`health penalty: ${healthPenalty}`);
  console.log("");
  console.log(`tenant breakdown (top ${topTenants.length} by frame volume):`);
  if (topTenants.length === 0) {
    console.log("  no tenant traffic recorded");
  } else {
    for (const tenant of topTenants) {
      console.log(
        `  ${tenant.tenantId}: frames=${tenant.totalFramesRaw} reduction=${(tenant.frameReductionRatio * 100).toFixed(2)}% latencyAvg=${safeRatio(tenant.latencyMsTotal, tenant.latencySamples).toFixed(2)}ms denies=${tenant.denyEvents} safety=${tenant.safetyEvents}`,
      );
    }
  }

  const advice: string[] = [];
  if (m.queueOverflowEvents > 0) {
    advice.push("increase --max-inbound-queue or reduce upstream message burst");
  }
  if (m.backpressureEvents > 0) {
    advice.push("tune --max-socket-backpressure-bytes and check downstream consumer speed");
  }
  if (m.tenantBreakerOpenEvents > 0 || m.sessionRollbackEvents > 0) {
    advice.push("evaluate --latency-budget-ms and batching window bounds for safer adaptive behavior");
  }
  if (p95QueueDelayMs > 5) {
