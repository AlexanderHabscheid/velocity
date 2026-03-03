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
  latencyBudgetMs: number;
  serverDelayMs: number;
  jitterMs: number;
  maxP95DeltaMs: number;
  maxAvgDeltaMs: number;
  minFrameReductionPct: number;
  minByteReductionPct: number;
}

export async function runBench(options: SingleBenchOptions): Promise<void> {
  const profile: BenchProfile = {
    name: "single",
    messages: options.messages,
    burst: options.burst,
    payloadBytes: options.payloadBytes,
    batchWindowMs: options.batchWindowMs,
    minBatchWindowMs: options.minBatchWindowMs,
    maxBatchWindowMs: options.maxBatchWindowMs,
    latencyBudgetMs: options.latencyBudgetMs,
    serverDelayMs: options.serverDelayMs,
    jitterMs: options.jitterMs,
    maxP95DeltaMs: options.maxP95DeltaMs,
    maxAvgDeltaMs: options.maxAvgDeltaMs,
    minFrameReductionPct: options.minFrameReductionPct,
    minByteReductionPct: options.minByteReductionPct,
  };

  const result = await runProfile(profile);
  printProfileResult(result);
}

export interface BenchCiOptions {
  outDir: string;
  profiles: string;
  failOnRegression: boolean;
  repeats: number;
  seed: number;
  baselineReport?: string;
  maxP95RegressionPct: number;
  maxP95RegressionMsFloor: number;
  maxByteReductionDropPct: number;
}

function getProfiles(selection: string): BenchProfile[] {
  const wanted = selection.split(",").map((x) => x.trim()).filter(Boolean);
  if (wanted.length === 0 || wanted.includes("all")) {
    return DEFAULT_CI_PROFILES;
  }

  const byName = new Map(DEFAULT_CI_PROFILES.map((p) => [p.name, p]));
  return wanted.map((name) => {
    const match = byName.get(name);
    if (!match) {
      throw new Error(`unknown profile: ${name}`);
    }
    return match;
  });
}

export async function runBenchCi(options: BenchCiOptions): Promise<void> {
  const profiles = getProfiles(options.profiles);
  const results: BenchProfileResult[] = [];

  for (const profile of profiles) {
    const runs: BenchProfileResult[] = [];
    for (let i = 0; i < options.repeats; i += 1) {
      runs.push(await runProfile(profile, options.seed + i));
    }
    const result = aggregateProfileRuns(profile, runs);
    results.push(result);
    printProfileResult(result);
  }

  const report: BenchReport = {
    generatedAt: new Date().toISOString(),
    results,
    passCount: results.filter((x) => x.pass).length,
    failCount: results.filter((x) => !x.pass).length,
  };

  const out = writeBenchReport(report, path.resolve(process.cwd(), options.outDir));
  console.log(`report json: ${out.jsonPath}`);
  console.log(`report md: ${out.markdownPath}`);

  let baselineFailures = 0;
  if (options.baselineReport) {
    const baselinePath = path.resolve(process.cwd(), options.baselineReport);
    const baselineRaw = fs.readFileSync(baselinePath, "utf8");
    const baseline = JSON.parse(baselineRaw) as BenchReport;
    const baselineByProfile = new Map(baseline.results.map((x) => [x.profile.name, x]));

    for (const result of report.results) {
      const previous = baselineByProfile.get(result.profile.name);
