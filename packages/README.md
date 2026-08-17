# Monorepo packages

The package boundaries are defined in `docs/internal/domain-model.md` and
`docs/internal/monorepo-plan.md`.

- `@glrs-dev/glorious-core` — provider-neutral domain contracts and extension SDK.
- `@glrs-dev/provider-registry` — provider adapters, credentials, and metadata.
- `@glrs-dev/glorious-coding-agent` — terminal coding-agent composition boundary.

The existing `v2/` runtime remains the compatibility implementation while the
extraction proceeds. New code must depend in the direction shown by the domain
model; core must not import product or extension packages.
