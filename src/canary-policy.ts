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

