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
  };

  const exportSnapshot = async (): Promise<void> => {
    const metrics = store.load();
    const attributes = [
      { key: "velocity.frames_raw_total", value: { intValue: metrics.totalFramesRaw } },
      { key: "velocity.frames_sent_total", value: { intValue: metrics.totalFramesSent } },
      { key: "velocity.bytes_raw_total", value: { intValue: metrics.totalBytesRaw } },
      { key: "velocity.bytes_sent_total", value: { intValue: metrics.totalBytesSent } },
      { key: "velocity.latency_samples_total", value: { intValue: metrics.latencySamples } },
      { key: "velocity.latency_total_ms", value: { doubleValue: metrics.latencyMsTotal } },
      { key: "velocity.queue_overflow_events_total", value: { intValue: metrics.queueOverflowEvents } },
      { key: "velocity.backpressure_events_total", value: { intValue: metrics.backpressureEvents } },
      { key: "velocity.tenant_breaker_open_events_total", value: { intValue: metrics.tenantBreakerOpenEvents } },
      { key: "velocity.session_rollback_events_total", value: { intValue: metrics.sessionRollbackEvents } },
      { key: "velocity.policy_denied_events_total", value: { intValue: metrics.policyDeniedEvents } },
      { key: "velocity.rate_limit_denied_events_total", value: { intValue: metrics.rateLimitDeniedEvents } },
      { key: "velocity.auth_rejected_events_total", value: { intValue: metrics.authRejectedEvents } },
      { key: "velocity.authz_denied_events_total", value: { intValue: metrics.authzDeniedEvents } },
    ];

    const body = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: { stringValue: serviceName },
              },
            ],
          },
          scopeLogs: [
            {
              scope: {
                name: "velocity",
              },
              logRecords: [
                {
                  timeUnixNano: nowUnixNanoString(),
                  severityText: "INFO",
                  body: {
                    stringValue: "velocity.metrics.snapshot",
                  },
                  attributes,
                },
              ],
            },
          ],
        },
      ],
    };

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        logger.warn("otlp export rejected", { status: resp.status, endpoint: url });
      }
    } catch (err) {
      logger.warn("otlp export failed", {
        endpoint: url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const interval = setInterval(tick, everyMs);
  interval.unref();
  tick();

  return {
    close: async () => {
      clearInterval(interval);
      if (inFlight) {
        await inFlight;
      }
    },
  };
}
