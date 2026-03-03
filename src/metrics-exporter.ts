import http from "node:http";
import { MetricsStore } from "./metrics-store";

export interface MetricsExporterHandle {
  close: () => Promise<void>;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

export function startMetricsExporter(store: MetricsStore, host: string, port: number): Promise<MetricsExporterHandle> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url !== "/metrics") {
        res.statusCode = 404;
        res.end("not found\n");
        return;
      }

      const m = store.load();
      const histogramBounds = [1, 2, 5, 10, 20, 50, 100, 250, 500, 1000];
      const histogramCounts = m.latencyHistogram ?? {};
      let running = 0;
      const histogramLines = histogramBounds.map((bound) => {
        running += histogramCounts[String(bound)] ?? 0;
        return `velocity_latency_ms_bucket{le=\"${bound}\"} ${running}`;
      });
      const inf = running + (histogramCounts["+Inf"] ?? 0);
      const lines = [
        "# TYPE velocity_frames_raw_total counter",
        `velocity_frames_raw_total ${m.totalFramesRaw}`,
        "# TYPE velocity_frames_sent_total counter",
        `velocity_frames_sent_total ${m.totalFramesSent}`,
        "# TYPE velocity_bytes_raw_total counter",
        `velocity_bytes_raw_total ${m.totalBytesRaw}`,
        "# TYPE velocity_bytes_sent_total counter",
        `velocity_bytes_sent_total ${m.totalBytesSent}`,
        "# TYPE velocity_batch_frames_total counter",
        `velocity_batch_frames_total ${m.totalBatchMembers}`,
        "# TYPE velocity_batch_groups_total counter",
        `velocity_batch_groups_total ${m.totalBatches}`,
        "# TYPE velocity_compressed_frames_total counter",
        `velocity_compressed_frames_total ${m.totalCompressedFrames}`,
        "# TYPE velocity_delta_frames_total counter",
        `velocity_delta_frames_total ${m.totalDeltaFrames}`,
        "# TYPE velocity_queue_overflow_events_total counter",
        `velocity_queue_overflow_events_total ${m.queueOverflowEvents}`,
        "# TYPE velocity_backpressure_events_total counter",
        `velocity_backpressure_events_total ${m.backpressureEvents}`,
        "# TYPE velocity_tenant_breaker_open_events_total counter",
        `velocity_tenant_breaker_open_events_total ${m.tenantBreakerOpenEvents}`,
        "# TYPE velocity_session_rollback_events_total counter",
        `velocity_session_rollback_events_total ${m.sessionRollbackEvents}`,
        "# TYPE velocity_policy_denied_events_total counter",
        `velocity_policy_denied_events_total ${m.policyDeniedEvents}`,
        "# TYPE velocity_rate_limit_denied_events_total counter",
        `velocity_rate_limit_denied_events_total ${m.rateLimitDeniedEvents}`,
        "# TYPE velocity_auth_rejected_events_total counter",
        `velocity_auth_rejected_events_total ${m.authRejectedEvents}`,
        "# TYPE velocity_authz_denied_events_total counter",
        `velocity_authz_denied_events_total ${m.authzDeniedEvents}`,
        "# TYPE velocity_latency_samples_total counter",
        `velocity_latency_samples_total ${m.latencySamples}`,
        "# TYPE velocity_loop_turn_samples_total counter",
        `velocity_loop_turn_samples_total ${m.loopTurnSamples}`,
        "# TYPE velocity_tool_roundtrip_samples_total counter",
        `velocity_tool_roundtrip_samples_total ${m.toolRoundtripSamples}`,
        "# TYPE velocity_frames_per_turn_samples_total counter",
        `velocity_frames_per_turn_samples_total ${m.framesPerTurnSamples}`,
        "# TYPE velocity_queue_delay_samples_total counter",
        `velocity_queue_delay_samples_total ${m.queueDelaySamples}`,
        "# TYPE velocity_latency_avg_ms gauge",
        `velocity_latency_avg_ms ${ratio(m.latencyMsTotal, m.latencySamples)}`,
        "# TYPE velocity_loop_turn_avg_ms gauge",
        `velocity_loop_turn_avg_ms ${ratio(m.loopTurnMsTotal, m.loopTurnSamples)}`,
        "# TYPE velocity_tool_roundtrip_avg_ms gauge",
        `velocity_tool_roundtrip_avg_ms ${ratio(m.toolRoundtripMsTotal, m.toolRoundtripSamples)}`,
        "# TYPE velocity_frames_per_turn_avg gauge",
        `velocity_frames_per_turn_avg ${ratio(m.framesPerTurnTotal, m.framesPerTurnSamples)}`,
        "# TYPE velocity_queue_delay_avg_ms gauge",
        `velocity_queue_delay_avg_ms ${ratio(m.queueDelayMsTotal, m.queueDelaySamples)}`,
        "# TYPE velocity_latency_ms histogram",
        ...histogramLines,
        `velocity_latency_ms_bucket{le=\"+Inf\"} ${inf}`,
        `velocity_latency_ms_sum ${m.latencyMsTotal}`,
        `velocity_latency_ms_count ${m.latencySamples}`,
        "# TYPE velocity_frame_reduction_ratio gauge",
        `velocity_frame_reduction_ratio ${ratio(m.totalFramesRaw - m.totalFramesSent, m.totalFramesRaw)}`,
        "# TYPE velocity_byte_reduction_ratio gauge",
        `velocity_byte_reduction_ratio ${ratio(m.totalBytesRaw - m.totalBytesSent, m.totalBytesRaw)}`,
      ];

      res.statusCode = 200;
      res.setHeader("content-type", "text/plain; version=0.0.4; charset=utf-8");
      res.end(`${lines.join("\n")}\n`);
    });

    server.once("error", (err) => reject(err));
    server.listen(port, host, () => {
      resolve({
        close: async () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((err) => (err ? closeReject(err) : closeResolve()));
          }),
      });
    });
  });
}
