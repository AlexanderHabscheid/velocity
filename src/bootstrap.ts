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
      metricsPort: 9464,
      stateDir: ".velocity",
    },
    controlPlane: {
      host: "127.0.0.1",
      port: 4200,
      storeEngine: "json",
      stateFile: ".velocity/control-plane-state.json",
      dbPath: ".velocity/control-plane.db",
    },
    policy: {
      opaEndpoint: "",
      opaPath: "velocity/allow",
      opaTimeoutMs: 250,
    },
    enterprise: {
      rateLimitControlPlaneEndpoint: "http://127.0.0.1:4200",
      jwtJwksUrl: "",
      jwtIssuer: "",
      jwtAudience: "",
      openfgaEndpoint: "",
      openfgaStoreId: "",
    },
  };

  const envExample = [
    "VELOCITY_TARGET=ws://localhost:4000",
    "VELOCITY_TARGET_POOL=",
    "VELOCITY_HOST=127.0.0.1",
    "VELOCITY_PORT=4100",
    "VELOCITY_LISTENER_ENGINE=ws",
    "VELOCITY_METRICS_PORT=9464",
    "VELOCITY_OPA_ENDPOINT=",
    "VELOCITY_RATE_LIMIT_CONTROL_PLANE_ENDPOINT=http://127.0.0.1:4200",
    "VELOCITY_RUNTIME_CONTROL_PLANE_ENDPOINT=http://127.0.0.1:4200",
    "VELOCITY_JWT_JWKS_URL=",
    "VELOCITY_OPENFGA_ENDPOINT=",
  ].join("\n");

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
