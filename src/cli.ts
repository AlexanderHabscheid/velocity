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

function resolvePerformanceProfile(raw: string): PerformanceProfile {
  if (raw === "low-latency" || raw === "balanced" || raw === "high-throughput") {
    return raw;
  }
  throw new Error(`invalid --performance-profile: ${raw} (expected one of low-latency|balanced|high-throughput)`);
}

function applyPerformanceProfile(
  rawOptions: Record<string, OptionValue>,
  command: Command,
  profile: PerformanceProfile,
): void {
  const overrides = PROFILE_OVERRIDES[profile];
  for (const [key, value] of Object.entries(overrides)) {
    if (command.getOptionValueSource(key) === "default") {
      rawOptions[key] = value;
    }
  }
}

function parseTargetPool(target: string, poolCsv: string): string[] {
  const extra = poolCsv.split(",").map((x) => x.trim()).filter(Boolean);
  return [...new Set([target, ...extra])];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const program = new Command();

program
  .name("velocity")
  .description("WebSocket multiplexer and batching layer")
  .version("0.1.0");

program
  .command("proxy")
  .requiredOption("--target <url>", "target WebSocket URL")
