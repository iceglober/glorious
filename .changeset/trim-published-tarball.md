---
"@glrs-dev/glorious": patch
---

Stop shipping test files in the published package. `files` listed the whole
`v2` directory, so 13 `.test.ts` files went out with every release. The tarball
drops from 40 files to 27.
