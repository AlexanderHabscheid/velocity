export interface TenantPolicy {
  tenantId: string;
  enabled: boolean;
  rateLimitRps: number;
  updatedAt: string;
}

export interface TenantPolicyUpdate {
  enabled?: boolean;
