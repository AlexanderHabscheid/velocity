# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1] - 2026-03-03

### Changed
- Set npm `NPM_TOKEN` expectations to automation-friendly usage (`bypass_2fa=true`) for CI publish compatibility.
- Renamed Python package distribution to `velocityai-cli` for PyPI.
- Bumped CLI, TypeScript SDK, and Python package versions to `0.1.1` for a clean re-release.

## [0.1.0] - 2026-03-02

### Added
- Production readiness baseline across CI, SDKs, and deployment manifests.
- Runtime profile endpoints in OpenAPI plus TypeScript/Python SDK coverage.
- Distributable SDK metadata for npm and PyPI publishing flows.
- Release governance documents: LICENSE and SECURITY policy.
- Package smoke gate to verify packed npm CLI installability and runtime startup checks.
- Go-live checklist document for release and deployment execution.

### Changed
- `velocity doctor` now reports optional checks as warnings instead of hard failures.
- Benchmark certification gate now enforces latency plus byte-reduction objectives.
- Kubernetes and compose deployment assets use pinned images and stronger runtime hardening defaults.
- Bench certification now supports an absolute p95 regression slack floor to reduce low-ms noise flake.
- JWT auth runtime dependency (`jose`) is now included in default CLI dependencies.
- npm package scopes now use `@velocityai` for CLI and TypeScript SDK distribution.
- Required-gate Autobahn job now patches missing `_version` module from upstream package release to keep CI stable.

### Notes
- Baseline benchmark report updated for byte-reduction certification.
