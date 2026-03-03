# OPA Policy Bundle

This folder provides a default OPA policy and data bundle for Velocity tenant authorization and rate limiting.

## Local Run

```bash
docker run --rm -p 8181:8181 \
  -v "$PWD/deploy/opa:/policy" \
  openpolicyagent/opa:latest \
  run --server --addr :8181 /policy/policy.rego /policy/data.json
```

## Wire Velocity

```bash
velocity proxy \
  --target ws://upstream:4000 \
  --opa-endpoint http://127.0.0.1:8181 \
  --opa-path velocity/allow \
  --opa-timeout-ms 250
```

## Decision Input

Velocity sends OPA input with:
- `tenantId`
- `headers` (flattened request headers)
- `remoteAddress`
- `ts`
