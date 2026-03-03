from __future__ import annotations

import argparse
from velocity_control_sdk.client import VelocityControlClient


def main() -> None:
    parser = argparse.ArgumentParser(prog="velocity-control")
    parser.add_argument("--url", default="http://127.0.0.1:4200")
    sub = parser.add_subparsers(dest="cmd", required=True)

    get_p = sub.add_parser("get-policy")
    get_p.add_argument("tenant_id")

    put_p = sub.add_parser("put-policy")
    put_p.add_argument("tenant_id")
    put_p.add_argument("--enabled", choices=["true", "false"])
    put_p.add_argument("--rate-limit-rps", type=int)

    check_rl = sub.add_parser("check-rate-limit")
    check_rl.add_argument("tenant_id")
    check_rl.add_argument("--rate-limit-rps", type=int)

    sub.add_parser("get-runtime-profile")

    put_runtime = sub.add_parser("put-runtime-profile")
    put_runtime.add_argument("--batch-window-ms", type=int)
    put_runtime.add_argument("--min-batch-window-ms", type=int)
    put_runtime.add_argument("--max-batch-window-ms", type=int)
    put_runtime.add_argument("--latency-budget-ms", type=int)
    put_runtime.add_argument("--batch-max-messages", type=int)
    put_runtime.add_argument("--batch-max-bytes", type=int)
    put_runtime.add_argument("--enable-zstd", choices=["true", "false"])
    put_runtime.add_argument("--enable-delta", choices=["true", "false"])
    put_runtime.add_argument("--safe-mode", choices=["true", "false"])
    put_runtime.add_argument("--enable-passthrough-merge", choices=["true", "false"])

