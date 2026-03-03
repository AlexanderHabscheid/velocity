export interface TenantPolicy {
  tenantId: string;
  enabled: boolean;
  rateLimitRps: number;
  updatedAt: string;
}

export interface TenantPolicyUpdate {
  enabled?: boolean;
  rateLimitRps?: number;
}

export interface TenantRateLimitDecision {
  allow: boolean;
  remainingTokens: number;
  updatedAt: string;
}

export interface RuntimeProfile {
  batchWindowMs: number;
  minBatchWindowMs: number;
  maxBatchWindowMs: number;
  latencyBudgetMs: number;
  batchMaxMessages: number;
  batchMaxBytes: number;
  enableZstd: boolean;
  enableDelta: boolean;
  safeMode: boolean;
  enablePassthroughMerge: boolean;
  updatedAt: string;
}

export interface RuntimeProfileUpdate {
  batchWindowMs?: number;
  minBatchWindowMs?: number;
  maxBatchWindowMs?: number;
  latencyBudgetMs?: number;
  batchMaxMessages?: number;
  batchMaxBytes?: number;
  enableZstd?: boolean;
  enableDelta?: boolean;
  safeMode?: boolean;
  enablePassthroughMerge?: boolean;
}

export class VelocityControlClient {
  constructor(private readonly baseUrl: string) {}

  async healthz(): Promise<{ ok: boolean; now: string }> {
    return this.request<{ ok: boolean; now: string }>("/healthz", { method: "GET" });
  }

  async getTenantPolicy(tenantId: string): Promise<TenantPolicy> {
    return this.request<TenantPolicy>(`/v1/tenants/${encodeURIComponent(tenantId)}/policy`, { method: "GET" });
  }

  async putTenantPolicy(tenantId: string, body: TenantPolicyUpdate): Promise<TenantPolicy> {
    return this.request<TenantPolicy>(`/v1/tenants/${encodeURIComponent(tenantId)}/policy`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async checkTenantRateLimit(tenantId: string, rateLimitRps?: number): Promise<TenantRateLimitDecision> {
    return this.request<TenantRateLimitDecision>(`/v1/tenants/${encodeURIComponent(tenantId)}/rate-limit/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rateLimitRps ? { rateLimitRps } : {}),
    });
  }

  async getRuntimeProfile(): Promise<RuntimeProfile> {
    return this.request<RuntimeProfile>("/v1/runtime/profile", { method: "GET" });
  }

  async putRuntimeProfile(body: RuntimeProfileUpdate): Promise<RuntimeProfile> {
    return this.request<RuntimeProfile>("/v1/runtime/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
