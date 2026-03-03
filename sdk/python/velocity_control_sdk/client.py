from __future__ import annotations

import json
import urllib.request
import urllib.parse
from dataclasses import dataclass
from typing import Optional


@dataclass
class TenantPolicy:
    tenant_id: str
    enabled: bool
    rate_limit_rps: int
    updated_at: str

@dataclass
class TenantRateLimitDecision:
    allow: bool
    remaining_tokens: float
    updated_at: str


@dataclass
class RuntimeProfile:
    batch_window_ms: int
    min_batch_window_ms: int
    max_batch_window_ms: int
    latency_budget_ms: int
    batch_max_messages: int
    batch_max_bytes: int
    enable_zstd: bool
    enable_delta: bool
    safe_mode: bool
    enable_passthrough_merge: bool
    updated_at: str


class VelocityControlClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def healthz(self) -> dict:
        return self._request("/healthz", method="GET")

    def get_tenant_policy(self, tenant_id: str) -> TenantPolicy:
        tenant = urllib.parse.quote(tenant_id, safe="")
        raw = self._request(f"/v1/tenants/{tenant}/policy", method="GET")
        return TenantPolicy(
            tenant_id=raw["tenantId"],
            enabled=raw["enabled"],
            rate_limit_rps=raw["rateLimitRps"],
            updated_at=raw["updatedAt"],
        )

    def put_tenant_policy(
        self,
        tenant_id: str,
        enabled: Optional[bool] = None,
        rate_limit_rps: Optional[int] = None,
    ) -> TenantPolicy:
        tenant = urllib.parse.quote(tenant_id, safe="")
        payload = {}
        if enabled is not None:
            payload["enabled"] = enabled
        if rate_limit_rps is not None:
            payload["rateLimitRps"] = rate_limit_rps
        raw = self._request(
            f"/v1/tenants/{tenant}/policy",
            method="PUT",
            body=payload,
        )
        return TenantPolicy(
            tenant_id=raw["tenantId"],
            enabled=raw["enabled"],
            rate_limit_rps=raw["rateLimitRps"],
            updated_at=raw["updatedAt"],
        )

    def check_tenant_rate_limit(
        self,
        tenant_id: str,
        rate_limit_rps: Optional[int] = None,
    ) -> TenantRateLimitDecision:
        tenant = urllib.parse.quote(tenant_id, safe="")
        payload = {}
        if rate_limit_rps is not None:
            payload["rateLimitRps"] = rate_limit_rps
        raw = self._request(
            f"/v1/tenants/{tenant}/rate-limit/check",
            method="POST",
            body=payload,
        )
        return TenantRateLimitDecision(
            allow=raw["allow"],
            remaining_tokens=raw["remainingTokens"],
            updated_at=raw["updatedAt"],
        )

    def get_runtime_profile(self) -> RuntimeProfile:
        raw = self._request("/v1/runtime/profile", method="GET")
        return RuntimeProfile(
            batch_window_ms=raw["batchWindowMs"],
            min_batch_window_ms=raw["minBatchWindowMs"],
            max_batch_window_ms=raw["maxBatchWindowMs"],
            latency_budget_ms=raw["latencyBudgetMs"],
            batch_max_messages=raw["batchMaxMessages"],
            batch_max_bytes=raw["batchMaxBytes"],
            enable_zstd=raw["enableZstd"],
            enable_delta=raw["enableDelta"],
            safe_mode=raw["safeMode"],
