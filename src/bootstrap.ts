import fs from "node:fs";
import path from "node:path";

interface BootstrapOptions {
  outDir: string;
  force: boolean;
}

export function runBootstrap(options: BootstrapOptions): void {
  const outDir = path.resolve(options.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const configPath = path.join(outDir, "velocity.config.json");
  const envPath = path.join(outDir, ".env.velocity.example");

  if (!options.force && (fs.existsSync(configPath) || fs.existsSync(envPath))) {
    throw new Error("bootstrap target already has velocity files; use --force to overwrite");
  }

  const config = {
    proxy: {
      target: "ws://localhost:4000",
      host: "127.0.0.1",
      port: 4100,
      listenerEngine: "ws",
      performanceProfile: "balanced",
      targetPool: "",
      batchWindowMs: 10,
      minBatchWindowMs: 0,
      maxBatchWindowMs: 20,
      latencyBudgetMs: 40,
      heartbeatIntervalMs: 25000,
      heartbeatTimeoutMs: 10000,
      listenerMaxPayloadBytes: 104857600,
      upstreamHandshakeTimeoutMs: 10000,
      upstreamMaxPayloadBytes: 104857600,
      zstd: true,
      zstdMinBytes: 512,
      zstdMinGainRatio: 0.03,
      delta: true,
