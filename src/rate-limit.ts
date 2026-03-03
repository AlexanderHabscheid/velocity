import { Logger } from "./logger";

export interface TenantRateLimiter {
  allow: (tenantId: string, rps: number) => Promise<boolean>;
}

export class LocalTenantRateLimiter implements TenantRateLimiter {
  private readonly buckets = new Map<string, { tokens: number; lastMs: number }>();

  async allow(tenantId: string, rps: number): Promise<boolean> {
    const now = Date.now();
    const perSecond = Math.max(1, rps);
    const current = this.buckets.get(tenantId) ?? { tokens: perSecond, lastMs: now };
    const elapsedSeconds = Math.max(0, (now - current.lastMs) / 1000);
    const refilled = Math.min(perSecond, current.tokens + elapsedSeconds * perSecond);
    if (refilled < 1) {
      this.buckets.set(tenantId, { tokens: refilled, lastMs: now });
      return false;
    }
    this.buckets.set(tenantId, { tokens: refilled - 1, lastMs: now });
    return true;
  }
}

export class ControlPlaneTenantRateLimiter implements TenantRateLimiter {
  constructor(
    private readonly endpoint: string,
    private readonly timeoutMs: number,
    private readonly failOpen: boolean,
    private readonly logger: Logger,
  ) {}

  async allow(tenantId: string, rps: number): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(50, this.timeoutMs));
    timeout.unref();

    try {
      const url = `${this.endpoint.replace(/\/+$/, "")}/v1/tenants/${encodeURIComponent(tenantId)}/rate-limit/check`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rateLimitRps: rps }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        this.logger.warn("remote rate-limit check failed", { tenantId, status: resp.status, url });
        return this.failOpen;
      }
      const body = await resp.json() as { allow?: boolean };
      return body.allow !== false;
    } catch (err) {
      this.logger.warn("remote rate-limit check error", {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return this.failOpen;
    } finally {
      clearTimeout(timeout);
    }
  }
}
