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
