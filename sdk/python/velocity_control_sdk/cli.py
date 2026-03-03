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

    args = parser.parse_args()
    client = VelocityControlClient(args.url)
    if args.cmd == "get-policy":
        print(client.get_tenant_policy(args.tenant_id))
        return
    if args.cmd == "check-rate-limit":
        print(client.check_tenant_rate_limit(args.tenant_id, rate_limit_rps=args.rate_limit_rps))
        return
    if args.cmd == "get-runtime-profile":
        print(client.get_runtime_profile())
        return
    if args.cmd == "put-runtime-profile":
        print(
            client.put_runtime_profile(
                batch_window_ms=args.batch_window_ms,
                min_batch_window_ms=args.min_batch_window_ms,
                max_batch_window_ms=args.max_batch_window_ms,
                latency_budget_ms=args.latency_budget_ms,
                batch_max_messages=args.batch_max_messages,
                batch_max_bytes=args.batch_max_bytes,
                enable_zstd=None if args.enable_zstd is None else args.enable_zstd == "true",
                enable_delta=None if args.enable_delta is None else args.enable_delta == "true",
                safe_mode=None if args.safe_mode is None else args.safe_mode == "true",
                enable_passthrough_merge=None if args.enable_passthrough_merge is None else args.enable_passthrough_merge == "true",
            )
        )
        return
    enabled = None if args.enabled is None else args.enabled == "true"
    print(client.put_tenant_policy(args.tenant_id, enabled=enabled, rate_limit_rps=args.rate_limit_rps))


if __name__ == "__main__":
    main()
