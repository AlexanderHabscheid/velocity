# VELOCITY

`velocity` is a TypeScript CLI proxy that sits between an agent and a WebSocket server to reduce frame count and byte overhead while guarding against latency regression.
It is package-first and terminal-first: there is no built-in web dashboard UI.

## Quickstart (Package-first)

```bash
npx velocity proxy --target ws://localhost:4000
npx velocity doctor
npx velocity bootstrap
```

Or install globally:

```bash
npm install -g velocity
velocity proxy --target ws://localhost:4000
velocity doctor
velocity bootstrap
```

## Core commands

```bash
velocity proxy --target ws://localhost:4000
velocity canary --target ws://localhost:4000
velocity doctor
velocity bootstrap
velocity stats
velocity stats --watch
velocity stats --watch --interval-ms 1000 --tenant-limit 20
velocity replay .velocity/traces/<trace>.jsonl
velocity bench
velocity bench-ci --fail-on-regression
```

Performance presets (CLI-only):

```bash
velocity proxy --target ws://localhost:4000 --performance-profile low-latency
velocity proxy --target ws://localhost:4000 --performance-profile high-throughput
velocity proxy --target ws://localhost:4000 --target-pool ws://10.0.0.11:4000,ws://10.0.0.12:4000
velocity proxy --target ws://localhost:4000 --runtime-control-plane-endpoint http://127.0.0.1:4200
```

## What it does

- Batches logical frames inside a configurable window.
- Adapts the batch window to a p95 latency budget.
- Negotiates capabilities with upstream via hello/hello-ack handshake.
- Falls back to JSON-RPC batch merge in passthrough mode for non-velocity upstreams.
- `--safe-mode` applies conservative runtime defaults (stricter latency guard, disabled risky optimizations).
- Per-tenant circuit breaker opens on sustained guard breaches and forces passthrough.
- Session rollback auto-switches to passthrough after repeated guard breaches.
- `velocity canary` assigns a tenant subset to safe-mode and auto-promotes clean tenants to full mode.
- Queue limits protect the proxy under bursty load (`--max-inbound-queue`, `--max-outstanding-batches`).
- Semantic coalescing deduplicates identical in-flight JSON-RPC tool calls and fans out responses by request id.
- Priority lane bypasses batching for critical methods (cancel/abort/interrupt/final/error style calls).
- Streaming-aware flush path sends stream/token/delta style traffic with low queue delay.
- Backpressure guard reacts when WebSocket buffered bytes exceed `--max-socket-backpressure-bytes`.
- Encodes transport envelopes with MessagePack.
- Optionally compresses envelopes with zstd.
- Payload-aware compression gates avoid wasting bytes on small/low-gain payloads.
- Optionally emits delta-only downstream updates when smaller.
- Records per-frame metrics and trace files.
- Rich terminal stats via `velocity stats` (including `--json` and `--verbose` modes).
- Optional Prometheus-style endpoint at `/metrics` when running long-lived service deployments.
- Structured log output (`--log-format json`) for ingestion pipelines.
- Optional OTLP HTTP export (`--otlp-http-endpoint`) for enterprise observability stacks.
- Auto-fallback: temporarily disables batching if queueing delay starts hurting RTT.
- Includes `bench` and `bench-ci` for multi-profile direct vs proxied validation.
- Includes `perf:bakeoff` script for `ws` vs `uWebSockets.js` transport baseline checks.
- Optional OPA policy hook supports per-tenant allow/deny and rate limit decisions.
- Durable control-plane store with default JSON-file engine and optional SQLite engine for tenant policy + distributed token-bucket checks.
- Optional Valkey-backed distributed rate-limit buckets via `--valkey-url`.
- Optional NATS runtime/control-plane event propagation via `--nats-url`.
- Optional listener engine selection (`ws` or `uWebSockets.js` when installed).
- Optional JWT authentication + OpenFGA authorization checks for enterprise access control.

## Bootstrap

Create local template config files for fast setup:

```bash
velocity bootstrap
```

This writes:
- `velocity.config.json`
- `.env.velocity.example`

Use `--out-dir` to target another directory and `--force` to overwrite.

Control-plane defaults to JSON-file persistence (stable, no experimental runtime warnings):

```bash
velocity control-plane --store-engine json --state-file .velocity/control-plane-state.json
```

SQLite is still available when explicitly selected:

```bash
velocity control-plane --store-engine sqlite --db-path .velocity/control-plane.db
```

Distributed mode (shared rate-limit buckets + event propagation):

```bash
velocity control-plane --store-engine json --state-file .velocity/control-plane-state.json --valkey-url redis://127.0.0.1:6379 --nats-url nats://127.0.0.1:4222
velocity proxy --target ws://localhost:4000 --rate-limit-control-plane-endpoint http://127.0.0.1:4200 --nats-url nats://127.0.0.1:4222
```

Hot runtime tuning (no proxy restart):

```bash
curl -X PUT http://127.0.0.1:4200/v1/runtime/profile \
  -H "content-type: application/json" \
  -d '{"batchWindowMs":2,"minBatchWindowMs":0,"maxBatchWindowMs":8,"latencyBudgetMs":20,"enableDelta":true}'

velocity proxy --target ws://localhost:4000 --runtime-control-plane-endpoint http://127.0.0.1:4200
```

## Proxy options

```bash
velocity proxy \
  --target ws://localhost:4000 \
  --listener-engine ws \
  --performance-profile balanced \
  --listener-max-payload-bytes 104857600 \
  --upstream-handshake-timeout-ms 10000 \
  --upstream-max-payload-bytes 104857600 \
  --no-upstream-per-message-deflate \
  --heartbeat-interval-ms 25000 \
  --heartbeat-timeout-ms 10000 \
  --target-pool ws://10.0.0.11:4000,ws://10.0.0.12:4000 \
  --target-pool-ewma-alpha 0.2 \
  --host 127.0.0.1 \
  --port 4100 \
  --batch-window-ms 10 \
  --min-batch-window-ms 0 \
  --max-batch-window-ms 20 \
  --latency-budget-ms 40 \
  --zstd \
  --zstd-min-bytes 512 \
  --zstd-min-gain-ratio 0.03 \
  --delta \
  --metrics-port 9464 \
  --rate-limit-control-plane-endpoint http://127.0.0.1:4200
```

## Observability

Default CLI flow (no web UI):

```bash
velocity stats
velocity stats --json
velocity stats --verbose
velocity stats --watch
```

`velocity stats` includes a tenant breakdown section by default (top tenants by frame volume).
It also reports agent loop KPIs (`loop turn avg`, `frames per turn avg`, `queue delay p95`) for end-to-end loop tuning.

Optional service-mode telemetry endpoint:

```bash
velocity proxy --target ws://localhost:4000 --metrics-port 9464
