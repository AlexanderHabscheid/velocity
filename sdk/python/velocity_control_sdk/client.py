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
