import { Logger } from "./logger";
import { MetricsStore } from "./metrics-store";

export interface OtlpExporterHandle {
  close: () => Promise<void>;
}

function normalizeLogsEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (trimmed.endsWith("/v1/logs")) {
    return trimmed;
  }
  if (trimmed.endsWith("/")) {
    return `${trimmed}v1/logs`;
  }
  return `${trimmed}/v1/logs`;
}

function nowUnixNanoString(): string {
  return `${BigInt(Date.now()) * 1000000n}`;
}

export function startOtlpExporter(
  store: MetricsStore,
  endpoint: string,
  intervalMs: number,
  serviceName: string,
  logger: Logger,
): OtlpExporterHandle {
  const url = normalizeLogsEndpoint(endpoint);
  const everyMs = Math.max(1000, intervalMs);
  let inFlight: Promise<void> | null = null;

  const tick = (): void => {
    if (inFlight) {
      return;
    }
    inFlight = exportSnapshot().finally(() => {
      inFlight = null;
    });
