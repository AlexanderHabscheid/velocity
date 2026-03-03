import http from "node:http";
import { ControlPlaneStore, JsonControlPlaneStore, SqliteControlPlaneStore, TenantPolicy, ValkeyRateLimitStore } from "./control-plane-store";
import { NatsEventBus, NoopEventBus, VelocityEventBus } from "./event-bus";

interface ControlPlaneOptions {
  host: string;
  port: number;
  storeEngine: "json" | "sqlite";
  stateFile: string;
  dbPath: string;
  valkeyUrl?: string;
  natsUrl?: string;
  eventSubjectPrefix?: string;
}

export interface ControlPlaneHandle {
  close: () => Promise<void>;
}

interface RuntimeProfile {
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

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(body)}\n`);
}

export function startControlPlane(host: string, port: number): Promise<ControlPlaneHandle> {
  return startControlPlaneWithOptions({
    host,
    port,
    storeEngine: "json",
    stateFile: ".velocity/control-plane-state.json",
    dbPath: ".velocity/control-plane.db",
    valkeyUrl: "",
    natsUrl: "",
    eventSubjectPrefix: "velocity.events",
  });
}

export function startControlPlaneWithOptions(options: ControlPlaneOptions): Promise<ControlPlaneHandle> {
  return Promise.all([startStore(options), startEventBus(options)]).then(([store, eventBus]) => {
    const runtimeProfile: RuntimeProfile = {
      batchWindowMs: 10,
      minBatchWindowMs: 0,
      maxBatchWindowMs: 20,
      latencyBudgetMs: 40,
      batchMaxMessages: 64,
      batchMaxBytes: 131072,
      enableZstd: false,
      enableDelta: false,
      safeMode: false,
      enablePassthroughMerge: true,
      updatedAt: new Date().toISOString(),
    };
    const publishEvent = async (topic: string, payload: Record<string, unknown>): Promise<void> => {
      try {
        await eventBus.publish(topic, payload);
      } catch (err) {
        console.warn(`velocity control-plane event publish failed topic=${topic} error=${err instanceof Error ? err.message : String(err)}`);
      }
    };
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", "http://velocity.local");
        if (req.method === "GET" && url.pathname === "/healthz") {
          writeJson(res, 200, { ok: true, now: new Date().toISOString(), storeEngine: options.storeEngine });
          return;
        }
        if (url.pathname === "/v1/runtime/profile") {
          if (req.method === "GET") {
            writeJson(res, 200, runtimeProfile);
            return;
          }
          if (req.method !== "PUT") {
            writeJson(res, 405, { error: "method_not_allowed" });
            return;
          }
          try {
            const payload = await readJson(req) as Partial<RuntimeProfile>;
            const next: RuntimeProfile = {
              ...runtimeProfile,
              ...payload,
              updatedAt: new Date().toISOString(),
            };
            if (next.batchWindowMs < 0 || next.minBatchWindowMs < 0 || next.maxBatchWindowMs < 0) {
              writeJson(res, 400, { error: "invalid_window" });
              return;
            }
            if (next.maxBatchWindowMs < next.minBatchWindowMs) {
              writeJson(res, 400, { error: "invalid_window_range" });
              return;
            }
            if (next.batchMaxMessages < 1 || next.batchMaxBytes < 1 || next.latencyBudgetMs < 1) {
              writeJson(res, 400, { error: "invalid_runtime_profile" });
              return;
            }
            Object.assign(runtimeProfile, next);
            void publishEvent("control_plane.runtime_profile_updated", runtimeProfile as unknown as Record<string, unknown>);
            writeJson(res, 200, runtimeProfile);
          } catch {
            writeJson(res, 400, { error: "invalid_json" });
          }
          return;
        }
        const policyMatch = /^\/v1\/tenants\/([^/]+)\/policy$/.exec(url.pathname);
        const rateLimitMatch = /^\/v1\/tenants\/([^/]+)\/rate-limit\/check$/.exec(url.pathname);
        if (!policyMatch && !rateLimitMatch) {
          writeJson(res, 404, { error: "not_found" });
          return;
        }
        const tenantId = decodeURIComponent((policyMatch ?? rateLimitMatch)?.[1] ?? "");
        if (policyMatch && req.method === "GET") {
          writeJson(res, 200, await store.getTenantPolicy(tenantId));
          return;
        }
        if (rateLimitMatch && req.method === "POST") {
          try {
            const payload = await readJson(req) as { rateLimitRps?: number };
            const result = await store.checkRateLimit(tenantId, payload.rateLimitRps);
            if (!result.allow) {
              void publishEvent("control_plane.rate_limit_denied", {
                tenantId,
                remainingTokens: result.remainingTokens,
              });
            }
            writeJson(res, 200, result);
          } catch {
            writeJson(res, 400, { error: "invalid_json" });
          }
          return;
        }
        if (!policyMatch || req.method !== "PUT") {
          writeJson(res, 405, { error: "method_not_allowed" });
          return;
