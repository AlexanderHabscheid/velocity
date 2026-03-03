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
}

function computeDecision(
  currentTokens: number,
  currentLastMs: number,
  perSecond: number,
  nowMs: number,
): { allow: boolean; nextTokens: number } {
  const elapsedSeconds = Math.max(0, (nowMs - currentLastMs) / 1000);
  const refilled = Math.min(perSecond, currentTokens + elapsedSeconds * perSecond);
  const allow = refilled >= 1;
  const nextTokens = allow ? refilled - 1 : refilled;
  return { allow, nextTokens };
}

export class JsonControlPlaneStore implements ControlPlaneStore {
  private readonly absolutePath: string;
  private state: JsonStoreState;
  private readonly flushDelayMs: number;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushPromise: Promise<void> | null = null;
  private dirty = false;
  private closed = false;
  private persistError: Error | null = null;

  constructor(statePath: string, flushDelayMs = 25) {
    this.absolutePath = path.resolve(statePath);
    this.flushDelayMs = Math.max(1, flushDelayMs);
    fs.mkdirSync(path.dirname(this.absolutePath), { recursive: true });
    this.state = this.readState();
  }

  async getTenantPolicy(tenantId: string): Promise<TenantPolicy> {
    return this.state.policies[tenantId] ?? defaultPolicy(tenantId);
  }

  async putTenantPolicy(tenantId: string, update: { enabled?: boolean; rateLimitRps?: number }): Promise<TenantPolicy> {
    const current = await this.getTenantPolicy(tenantId);
    const next: TenantPolicy = {
      tenantId,
      enabled: update.enabled !== undefined ? update.enabled : current.enabled,
      rateLimitRps: typeof update.rateLimitRps === "number" ? Math.max(1, Math.floor(update.rateLimitRps)) : current.rateLimitRps,
      updatedAt: new Date().toISOString(),
    };
    this.state.policies[tenantId] = next;
    this.persist();
    return next;
  }

  async checkRateLimit(tenantId: string, rateLimitRps?: number): Promise<RateLimitDecision> {
    const policy = await this.getTenantPolicy(tenantId);
    const perSecond = Math.max(1, Math.floor(rateLimitRps ?? policy.rateLimitRps));
    const nowMs = Date.now();

    const current = this.state.buckets[tenantId] ?? { tokens: perSecond, lastMs: nowMs };
    const decision = computeDecision(current.tokens, current.lastMs, perSecond, nowMs);

    this.state.buckets[tenantId] = { tokens: decision.nextTokens, lastMs: nowMs };
    this.persist();

    return {
      allow: decision.allow,
      remainingTokens: Number(decision.nextTokens.toFixed(3)),
      updatedAt: new Date(nowMs).toISOString(),
    };
  }

  private readState(): JsonStoreState {
    if (!fs.existsSync(this.absolutePath)) {
      return { policies: {}, buckets: {} };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.absolutePath, "utf8")) as JsonStoreState;
      return {
        policies: parsed.policies ?? {},
        buckets: parsed.buckets ?? {},
      };
    } catch {
      return { policies: {}, buckets: {} };
    }
  }

  private persist(): void {
    if (this.closed) {
      return;
    }
    this.dirty = true;
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush().catch((err) => {
        this.persistError = err instanceof Error ? err : new Error(String(err));
      });
    }, this.flushDelayMs);
    this.flushTimer.unref();
  }

  private flush(): Promise<void> {
    if (this.flushPromise) {
      return this.flushPromise;
    }
    this.flushPromise = (async () => {
      while (this.dirty) {
        this.dirty = false;
        const serialized = `${JSON.stringify(this.state, null, 2)}\n`;
        const tmp = `${this.absolutePath}.tmp`;
        await fs.promises.writeFile(tmp, serialized, "utf8");
        await fs.promises.rename(tmp, this.absolutePath);
      }
    })().finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.dirty) {
      await this.flush();
    } else if (this.flushPromise) {
      await this.flushPromise;
    }
    if (this.persistError) {
      throw this.persistError;
    }
  }
}

export class SqliteControlPlaneStore implements ControlPlaneStore {
  private readonly db: any;

  constructor(dbPath: string, db: any) {
    const absolutePath = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    this.db = new db.DatabaseSync(absolutePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tenant_policies (
        tenant_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL,
        rate_limit_rps INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rate_limit_buckets (
        tenant_id TEXT PRIMARY KEY,
        tokens REAL NOT NULL,
        last_ms INTEGER NOT NULL
      );
    `);
  }

  static async create(dbPath: string): Promise<SqliteControlPlaneStore> {
    const sqlite = await import("node:sqlite");
    return new SqliteControlPlaneStore(dbPath, sqlite);
  }
