#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { runBench, runBenchCi } from "./bench";
import { MetricsStore } from "./metrics-store";
import { startProxy } from "./proxy";
import { replayTrace } from "./replay";
import { printStatsWithOptions } from "./stats";
import { startControlPlaneWithOptions } from "./control-plane";
import { runDoctor } from "./doctor";
import { runBootstrap } from "./bootstrap";

type PerformanceProfile = "balanced" | "low-latency" | "high-throughput";
type OptionValue = string | boolean;

const PROFILE_OVERRIDES: Record<PerformanceProfile, Record<string, OptionValue>> = {
  balanced: {},
  "low-latency": {
    batchWindowMs: "1",
    minBatchWindowMs: "0",
    maxBatchWindowMs: "4",
    latencyBudgetMs: "15",
    batchMaxMessages: "24",
    batchMaxBytes: "65536",
    zstd: false,
    delta: false,
    safeMode: true,
  },
  "high-throughput": {
    batchWindowMs: "15",
    minBatchWindowMs: "2",
    maxBatchWindowMs: "30",
    latencyBudgetMs: "100",
    batchMaxMessages: "256",
    batchMaxBytes: "262144",
    zstd: true,
    delta: true,
    safeMode: false,
  },
};
