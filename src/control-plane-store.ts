import fs from "node:fs";
import path from "node:path";

export interface TenantPolicy {
  tenantId: string;
  enabled: boolean;
  rateLimitRps: number;
  updatedAt: string;
}

export interface RateLimitDecision {
  allow: boolean;
  remainingTokens: number;
  updatedAt: string;
}

export interface ControlPlaneStore {
  getTenantPolicy(tenantId: string): Promise<TenantPolicy>;
  putTenantPolicy(tenantId: string, update: { enabled?: boolean; rateLimitRps?: number }): Promise<TenantPolicy>;
  checkRateLimit(tenantId: string, rateLimitRps?: number): Promise<RateLimitDecision>;
  close?: () => Promise<void>;
}

const DEFAULT_POLICY = {
  enabled: true,
  rateLimitRps: 100,
};

interface JsonStoreState {
  policies: Record<string, TenantPolicy>;
  buckets: Record<string, { tokens: number; lastMs: number }>;
}

function defaultPolicy(tenantId: string): TenantPolicy {
  return {
    tenantId,
    enabled: DEFAULT_POLICY.enabled,
    rateLimitRps: DEFAULT_POLICY.rateLimitRps,
    updatedAt: new Date(0).toISOString(),
  };
