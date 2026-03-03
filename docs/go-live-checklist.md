# Velocity Go-Live Checklist

This checklist is the deployment gate for turning Velocity into a usable, installable package for external AI systems.

## Release gates (must pass)

- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run contract:check`
- [ ] `npm run bench:ci`
- [ ] `npm run bench:certify`
- [ ] `npm run package:smoke`

## Packaging integrity

- [ ] `npm pack` tarball contains `dist/`, `README.md`, `LICENSE`, `openapi/` only (as declared by `files`)
- [ ] Tarball installs in a clean temp project
- [ ] `npx velocity --version` returns the release version
- [ ] `npx velocity doctor` runs from installed package

## Runtime dependency integrity

- [ ] JWT path works without manual dependency patching (`jose` in runtime dependencies)
- [ ] Optional features are clearly documented (`zstd-wasm`, `uWebSockets.js`)

## Bench certification policy

- [ ] Baseline report exists (`ci/bench/baseline-report.json`)
- [ ] Certification guard uses both relative and absolute p95 slack to reduce sub-ms noise flakiness
- [ ] Byte-reduction regression guard remains enforced

## Deployment artifacts

- [ ] Docker image builds from `Dockerfile`
- [ ] `deploy/docker-compose.prod.yml` boots proxy + control-plane + dependencies
- [ ] Kubernetes manifests apply cleanly in staging
- [ ] Health checks pass (`/healthz`, proxy listen socket, metrics endpoint if enabled)

## SDK publish readiness

- [ ] TypeScript SDK builds (`sdk/typescript`)
- [ ] Python SDK builds (`sdk/python`)
- [ ] Control-plane OpenAPI matches SDK operations (`npm run contract:check`)

## Release workflow readiness

- [ ] `.github/workflows/required-gate.yml` includes package smoke validation
- [ ] `.github/workflows/release.yml` verify job runs `npm run release:verify`
- [ ] Secrets exist for npm (`NPM_TOKEN`) and PyPI (`PYPI_API_TOKEN`)

## Post-deploy validation

- [ ] Run live canary (`velocity canary`) against representative tenants
- [ ] Confirm no sustained p95 regression versus direct path
- [ ] Confirm tenant policy/rate-limit decisions are observable in logs and metrics

