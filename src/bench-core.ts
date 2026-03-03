import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";
import { loadOutboundReduction } from "./bench-metrics";
import { createRng, hashSeed } from "./bench-rng";
import { startProxy } from "./proxy";

export interface BenchProfile {
  name: string;
  messages: number;
  burst: number;
  payloadBytes: number;
  batchWindowMs: number;
  minBatchWindowMs: number;
  maxBatchWindowMs: number;
  latencyBudgetMs: number;
  serverDelayMs: number;
  jitterMs: number;
  maxP95DeltaMs: number;
  maxAvgDeltaMs: number;
  minFrameReductionPct: number;
  minByteReductionPct: number;
}

interface TrialResult {
  latencies: number[];
  logicalBytesSent: number;
  logicalBytesReceived: number;
  elapsedMs: number;
}

export interface BenchProfileResult {
  profile: BenchProfile;
  direct: TrialResult;
  proxied: TrialResult;
  frameReductionPct: number;
  byteReductionPct: number;
