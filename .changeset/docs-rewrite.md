---
"@glrs-dev/glrs": minor
---

The published documentation is nine pages, all of them true.

Fifteen pages became nine, flat and numbered, with no directories. The old tree had two `4-` and three `5-` at the top level and a `5-customize` with no `2-`; flat is also what the two readers of this directory have in common, since the site orders by a plain `localeCompare` over the path and glrs itself reaches these files with `read` and `grep`. That comparator is not numeric-aware, which sets the ceiling: a tenth page would sort directly after the first.

Merges that removed a seam rather than a page: providers and models were one subject split in two, and the split showed — the same cloud-settings block appeared byte-identical in both. Terminal setup is a section of using a session, not a peer of it. Commands, skills and `AGENTS.md` are three spellings of "a file on disk changes glrs's behaviour" and share a discovery rule that was stated three times and completely nowhere. Architecture and lifecycle described the same turn twice.

Troubleshooting went entirely: everything on it lived elsewhere, and its worked examples no longer parse. Philosophy went as a page and stayed as content — the permission argument moves to the tools page, where the reader meets the consequence.

**Eighty-three factual errors were found and corrected**, fifty-five of them claims the code contradicted. The corpus grew even so, because fourteen things existed in code and were documented nowhere: `glrs --help`, `/fork`, that a skill's `allowed-tools` is enforced for the activating turn, the credential variable names — an agent reading this directory could not previously learn a single one — the package's SDK entry, and cache breakpoints on providers that need them.

Five paths in source named documentation files that do not exist, including one the system prompt tells the model to read.
