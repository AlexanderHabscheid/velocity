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
      assignedAt: now,
      sessions: 0,
      breakerOpens: 0,
    };

    state.breakerOpens += 1;
    let demoted = false;
    if (!state.safeMode) {
      state.safeMode = true;
      state.assignedAt = now;
      state.sessions = 0;
      state.breakerOpens = 1;
      delete state.promotedAt;
      demoted = true;
    }

    this.tenants.set(tenantId, state);
    this.persist();
    return { safeMode: state.safeMode, promoted: false, demoted };
  }

  private load(): void {
    if (!this.config.stateFile || !fs.existsSync(this.config.stateFile)) {
      return;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.config.stateFile, "utf8")) as CanaryStateFile;
      for (const [tenant, state] of Object.entries(parsed.tenants ?? {})) {
        this.tenants.set(tenant, state);
      }
    } catch {
      // ignore malformed canary state
    }
  }

  private persist(): void {
    if (!this.config.stateFile) {
      return;
    }
    const payload: CanaryStateFile = {
      tenants: Object.fromEntries(this.tenants.entries()),
    };
    fs.writeFileSync(this.config.stateFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}
