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
