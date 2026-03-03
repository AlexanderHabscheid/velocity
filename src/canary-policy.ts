import fs from "node:fs";

interface TenantCanaryState {
  safeMode: boolean;
  assignedAt: number;
  sessions: number;
  breakerOpens: number;
  promotedAt?: number;
}

interface CanaryStateFile {
  tenants: Record<string, TenantCanaryState>;
}

export interface CanaryConfig {
  percent: number;
  promotionWindowMs: number;
  minSessions: number;
  stateFile?: string;
}

export interface CanaryDecision {
  safeMode: boolean;
  promoted: boolean;
  demoted: boolean;
}

function hashToPercent(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 100;
}

export class CanaryPolicyManager {
  private readonly config: CanaryConfig;
  private readonly tenants = new Map<string, TenantCanaryState>();

  constructor(config: CanaryConfig) {
    this.config = config;
    this.load();
  }

  onSessionStart(tenantId: string): CanaryDecision {
    const now = Date.now();
    let state = this.tenants.get(tenantId);
    if (!state) {
      const bucket = hashToPercent(tenantId);
      state = {
        safeMode: bucket < this.config.percent,
        assignedAt: now,
        sessions: 0,
        breakerOpens: 0,
      };
      this.tenants.set(tenantId, state);
    }

    state.sessions += 1;
    let promoted = false;
    if (
      state.safeMode &&
      now - state.assignedAt >= this.config.promotionWindowMs &&
      state.sessions >= this.config.minSessions &&
      state.breakerOpens === 0
    ) {
      state.safeMode = false;
      state.promotedAt = now;
      promoted = true;
    }

    this.persist();
    return { safeMode: state.safeMode, promoted, demoted: false };
  }

  recordBreakerOpen(tenantId: string): CanaryDecision {
    const now = Date.now();
    const state = this.tenants.get(tenantId) ?? {
      safeMode: true,
