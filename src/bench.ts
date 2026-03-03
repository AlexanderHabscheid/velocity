import path from "node:path";
import fs from "node:fs";
import { aggregateProfileRuns } from "./bench-aggregate";
import { writeBenchReport } from "./bench-report";
import { BenchProfile, BenchProfileResult, BenchReport, DEFAULT_CI_PROFILES, runProfile } from "./bench-core";

function printProfileResult(result: BenchProfileResult): void {
  console.log(`profile: ${result.profile.name}`);
  console.log(`  p95 latency delta: ${result.p95DeltaMs.toFixed(2)}ms (${result.p95DeltaPct.toFixed(2)}%)`);
  console.log(`  avg latency delta: ${result.avgDeltaMs.toFixed(2)}ms (${result.avgDeltaPct.toFixed(2)}%)`);
  console.log(`  frame reduction: ${result.frameReductionPct.toFixed(2)}%`);
  console.log(`  byte reduction: ${result.byteReductionPct.toFixed(2)}%`);
  console.log(`  state dir: ${result.stateDir}`);
  console.log(`  result: ${result.pass ? "PASS" : "WARN"}`);
}

export interface SingleBenchOptions {
  messages: number;
  burst: number;
  payloadBytes: number;
  batchWindowMs: number;
  minBatchWindowMs: number;
  maxBatchWindowMs: number;
