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
