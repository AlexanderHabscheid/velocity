# Velocity First 15 Minutes

This walkthrough gets a new team from install to a working proxy path for agent traffic, then enables policy checks.

## 1) Install CLI (2 minutes)

```bash
npm install -g @velocityai/velocity
velocity --version
```

## 2) Start an upstream WebSocket target (2 minutes)

Velocity sits between an agent and an upstream WebSocket server. If you already have one, use that URL and skip this step.

For local testing, run any WebSocket echo or test server at `ws://127.0.0.1:4000`.

## 3) Run Velocity proxy in front of upstream (3 minutes)

```bash
velocity proxy \
  --target ws://127.0.0.1:4000 \
  --host 127.0.0.1 \
  --port 4100 \
  --performance-profile low-latency \
  --metrics-port 9464
```

Your agent should now connect to `ws://127.0.0.1:4100` instead of the upstream directly.

## 4) Point an agent at Velocity (3 minutes)

Update the agent WebSocket endpoint:

- Before: `ws://127.0.0.1:4000`
- After: `ws://127.0.0.1:4100`

Validate runtime health:

```bash
velocity doctor
curl http://127.0.0.1:9464/metrics | head
```

## 5) Enable policy checks with OPA (5 minutes)

Create a minimal OPA policy that allows traffic by default:

```bash
mkdir -p .velocity/opa
cat > .velocity/opa/velocity.rego <<'EOF'
package velocity

default allow := true
EOF
```

Run OPA:

```bash
docker run --rm -p 8181:8181 -v "$PWD/.velocity/opa:/policy" openpolicyagent/opa:latest \
  run --server /policy/velocity.rego
```

Restart Velocity proxy with OPA enabled:

```bash
velocity proxy \
  --target ws://127.0.0.1:4000 \
  --host 127.0.0.1 \
  --port 4100 \
  --opa-endpoint http://127.0.0.1:8181 \
  --opa-path velocity/allow
```

At this point, agent traffic is being checked through OPA before forwarding.

## What to do next

- Add tenant-aware policy inputs/rules in OPA.
- Add control-plane for distributed rate limits:
  `velocity control-plane --store-engine json --state-file .velocity/control-plane-state.json`
- Enable runtime tuning without restart:
  `--runtime-control-plane-endpoint http://127.0.0.1:4200`
