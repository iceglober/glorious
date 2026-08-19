# Monorepo packages

The package boundaries are defined in `docs/internal/domain-model.md` and
`docs/internal/monorepo-plan.md`.

- `glrs-core` — provider-neutral domain contracts and extension SDK.
- `provider-registry` — provider adapters, credentials, and metadata.
- `glrs-coding-agent` — terminal coding-agent composition boundary.

These internal packages are private implementation boundaries. The root
`@glrs-dev/glrs` package is the only npm distribution.

The coding-agent implementation now lives in its product package. New code must
depend in the direction shown by the domain model; core must not import product
or extension packages.
