# @glrs-dev/glrs-ext-telemetry

Consent-gated OpenTelemetry metrics for model requests and prompt-cache performance.

The first interactive session asks once and stores the answer in the user config. Headless runs never ask. `DO_NOT_TRACK=1`, `DNT=1`, `OTEL_SDK_DISABLED=true`, and `OTEL_METRICS_EXPORTER=none` disable telemetry regardless of consent.

The exporter reads standard `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, and `OTEL_METRIC_EXPORT_INTERVAL` settings. It exports provider/endpoint/cache-strategy dimensions, durations, and token counts, never prompts, paths, credentials, request bodies, or session identifiers.
