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
