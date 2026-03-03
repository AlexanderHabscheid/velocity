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
