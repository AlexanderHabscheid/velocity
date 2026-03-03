# OpenTelemetry Collector

Use `collector-config.yaml` to receive OTLP HTTP data from Velocity (`--otlp-http-endpoint`) and forward it to downstream observability stacks.

Example:

```bash
docker run --rm -p 4318:4318 -p 9465:9465 \
  -v "$PWD/deploy/otel/collector-config.yaml:/etc/otelcol/config.yaml" \
  otel/opentelemetry-collector:latest
```
