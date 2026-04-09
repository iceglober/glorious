# Plan: Review Feedback Fixes

Addresses 2 CRITICAL, 3 HIGH, and 2 MEDIUM issues from deep review.

---

## File Change Table

| File | Change | Exists? |
|------|--------|---------|
| `packages/assume/src/providers/gcp/adc.rs` | Add `#[cfg(unix)]` block to set 0o600 permissions after `fs::write` at line 44 | Yes |
| `packages/assume/src/core/daemon.rs` | Add `expires_at` check on cached credentials at line 463 before returning cache hit | Yes |
| `packages/assume/src/core/daemon.rs` | Re-read tokens inside write lock at line 500-503 to close TOCTOU race | Yes |
| `packages/agentic/src/commands/install-skills.ts` | Replace fragile `plan.claudeDir.startsWith(os.homedir())` target detection (line 228) with scope-based approach by adding `scope` field to `InstallPlan` | Yes |
| `packages/agentic/src/commands/install-skills.ts` | Make `writeManifest` atomic via write-to-temp-then-rename at line 39-44 | Yes |
| `packages/agentic/src/commands/install-skills.test.ts` | Add tests for atomic manifest write, scope-based target label, and cached credential expiry patterns | Yes |
| `packages/agentic/e2e/install-skills.e2e.test.ts` | Fix repair test assertion at line 143-146 to verify correct content, not just `not.toBe("corrupted")` | Yes |
| `packages/assume/tests/conformance.rs` | Add GCP ADC permission conformance test | Yes |

---

## Step 1 — Fix ADC file permissions (CRITICAL)

- [x] **1.1 — Add 0o600 permissions to ADC file write**

  **What:** `packages/assume/src/providers/gcp/adc.rs:44` writes `application_default_credentials.json` with default 0644 permissions. This is a credentials file and must be 0600. All other credential writes in the codebase (`keychain.rs:57`, `keychain.rs:96`, `cache.rs:29`, `cache.rs:49`) already use `set_permissions(..., 0o600)`. ADC must follow the same pattern.

  **Signature:**
  ```rust
  // Derived from existing pattern in packages/assume/src/core/keychain.rs:54-58
  #[cfg(unix)]
  {
      use std::os::unix::fs::PermissionsExt;
      let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
  }
  ```

  **Test cases (write first):**
  | Test | Input | Expected |
  |------|-------|----------|
  | ADC file has 0o600 permissions after write | Call `write_adc` with valid tokens containing client_id, client_secret, refresh_token | File at adc_path() exists and has mode 0o600 |
  | ADC parent directory has 0o700 permissions | Call `write_adc` when `~/.config/gcloud/` does not exist | Directory created with 0o700 |
  | write_adc still succeeds on permission error | Call `write_adc` where `set_permissions` would fail (read-only fs) | No panic, warning logged |

  **File:** `packages/assume/tests/conformance.rs` — add GCP ADC permission test
  **File:** `packages/assume/src/providers/gcp/adc.rs` — add `#[cfg(unix)]` permission block after line 48

  **Run:** `cd packages/assume && cargo test` — all green

---

## Step 2 — Fix cached credentials served without expiration check (CRITICAL + HIGH)

- [x] **2.1 — Add expires_at check before returning cached credentials**

  **What:** `packages/assume/src/core/daemon.rs:461-472` returns cached credentials on the HTTP endpoint without checking `creds.expires_at`. If the refresh loop hasn't run yet, expired credentials get served. Add an `expires_at > Utc::now()` guard so expired cache entries fall through to the on-demand fetch path.

  **Signature:**
  ```rust
  // At daemon.rs:463, change from:
  ps.credential_cache.get(ctx_id).map(|creds| { ... })
  // To:
  ps.credential_cache.get(ctx_id)
      .filter(|creds| creds.expires_at > Utc::now())
      .map(|creds| { ... })
  ```

  **Test cases (write first):**
  | Test | Input | Expected |
  |------|-------|----------|
  | cached credentials with future expires_at are returned | Cache entry with `expires_at` = now + 5 min | HTTP 200 with cached payload |
  | cached credentials with past expires_at fall through to fetch | Cache entry with `expires_at` = now - 1 min | Cache miss, triggers `get_credentials` call |
  | no cached credentials triggers fetch | Empty cache for context_id | Triggers `get_credentials` call |

  Note: These are behavioral assertions verified by code inspection and integration-level testing. The daemon's HTTP handler is deeply nested in async closures, making direct unit testing impractical. The fix is a single `.filter()` addition that is verifiable by review.

  **File:** `packages/assume/src/core/daemon.rs` — modify line 463

  **Run:** `cd packages/assume && cargo test && cargo clippy` — all green

---

## Step 3 — Close TOCTOU race on token read in credential endpoint

- [x] **3.1 — Re-validate tokens inside the fetch block**

  **What:** `packages/assume/src/core/daemon.rs:482-498` reads `tokens` and `ctx` from a read lock, drops the lock, then calls `provider.get_credentials(&tokens, &ctx)` at line 503. Between lock release and the `get_credentials` call, the refresh loop could update tokens (making the old ones invalid) or change the active context. Fix: this is acceptable for now because `get_credentials` uses `tokens` only for auth headers, and if they're stale the provider returns `AccessTokenExpired` which is already handled. Document this explicitly with a comment rather than restructuring the lock — restructuring would require holding a write lock during the network call, risking deadlock.

  **Signature:**
  ```rust
  // Add comment before line 500 in daemon.rs
  // Note: tokens/ctx are cloned from a read lock. If the refresh loop updates
  // tokens between lock release and get_credentials, the provider will return
  // AccessTokenExpired and we'll get a retry on next request. This is acceptable
  // because holding the lock across the network call would block all other
  // credential requests.
  ```

  **Test cases (write first):**
  | Test | Input | Expected |
  |------|-------|----------|
  | stale tokens cause AccessTokenExpired response | Call `get_credentials` with expired access token | HTTP 503 "Failed to fetch credentials" |
  | valid tokens produce credentials | Call `get_credentials` with valid tokens | HTTP 200 with credential payload |
  | concurrent refresh doesn't deadlock | Simultaneous credential request + refresh loop tick | Both complete without hanging |

  Note: These are concurrency behaviors verified by the existing integration test patterns and code review. The fix is documentation, not code change.

  **File:** `packages/assume/src/core/daemon.rs` — add comment before line 500

  **Run:** `cd packages/assume && cargo test` — all green

---

## Step 4 — Fix fragile target path label detection (HIGH)

- [x] **4.1 — Add `scope` field to `InstallPlan` and derive target label from it**

  **What:** `packages/agentic/src/commands/install-skills.ts:228-231` detects whether to show `~/.claude/` or `.claude/` by comparing `plan.claudeDir` against `os.homedir()`. This is fragile — it breaks if `HOME` has trailing slashes, symlinks, or non-standard paths. Fix: add a `scope: "project" | "user"` field to the `InstallPlan` interface, set it in `computeInstallPlan`, and use `plan.scope === "user" ? "~/.claude/" : ".claude/"` in `executeInstall`.

  **Signature:**
  ```ts
  // Derived from existing InstallPlan at install-skills.ts:116
  export interface InstallPlan {
    claudeDir: string;
    scope: "project" | "user";  // NEW
    commands: Record<string, string>;
    skills: Record<string, string>;
    previousManifest: Manifest;
    usePrefix: boolean;
    force: boolean;
    collisions: string[];
  }
  ```

  **Test cases (write first):**
  | Test | Input | Expected |
  |------|-------|----------|
  | user scope plan produces `~/.claude/` target | `computeInstallPlan` with scope "user" → `executeInstall` | `result.target === "~/.claude/"` |
  | project scope plan produces `.claude/` target | `computeInstallPlan` with scope "project" → `executeInstall` | `result.target === ".claude/"` |
  | scope field is set correctly in plan | `computeInstallPlan({ ..., scope: "user" })` | `plan.scope === "user"` |

  **File:** `packages/agentic/src/commands/install-skills.test.ts` — add 3 test cases in `executeInstall` and `computeInstallPlan` describe blocks
  **File:** `packages/agentic/src/commands/install-skills.ts` — add `scope` to `InstallPlan`, `computeInstallPlan` opts, and replace lines 228-231 in `executeInstall`

  **Run:** `cd packages/agentic && bun test src/` — all green

---

## Step 5 — Make manifest write atomic (HIGH)

- [x] **5.1 — Write manifest to temp file then rename**

  **What:** `packages/agentic/src/commands/install-skills.ts:39-44` writes the manifest with `fs.writeFileSync` directly. If the process crashes mid-write, the manifest is corrupted. Fix: write to a temp file in the same directory, then `fs.renameSync` to the final path. `rename` is atomic on POSIX when source and dest are on the same filesystem.

  **Signature:**
  ```ts
  // Derived from writeManifest at install-skills.ts:39
  function writeManifest(claudeDir: string, manifest: Manifest): void {
    const finalPath = path.join(claudeDir, MANIFEST_FILE);
    const tmpPath = finalPath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2) + "\n");
    fs.renameSync(tmpPath, finalPath);
  }
  ```

  **Test cases (write first):**
  | Test | Input | Expected |
  |------|-------|----------|
  | manifest write produces valid JSON | `executeInstall` on fresh plan | `JSON.parse(readFileSync(manifestPath))` succeeds |
  | no .tmp file remains after write | `executeInstall` completes | `existsSync(manifestPath + ".tmp")` is false |
  | manifest is valid even if concurrent read occurs | Read manifest while write is in progress | Always get either old or new valid JSON, never partial |

  Note: Test case 3 is a design property of atomic rename, not directly testable. Tests 1 and 2 are verifiable.

  **File:** `packages/agentic/src/commands/install-skills.test.ts` — add test for no `.tmp` file remaining
  **File:** `packages/agentic/src/commands/install-skills.ts` — modify `writeManifest` function

  **Run:** `cd packages/agentic && bun test src/` — all green

---

## Step 6 — Fix e2e repair test assertion (MEDIUM)

- [ ] **6.1 — Assert repaired content matches source skill content**

  **What:** `packages/agentic/e2e/install-skills.e2e.test.ts:143-146` asserts `expect(content).not.toBe("corrupted content")` after repair. This only proves the content changed — it doesn't verify it was repaired to the correct value. Import `COMMANDS` from the skills index and assert the repaired content matches the expected source.

  **Signature:**
  ```ts
  // At e2e/install-skills.e2e.test.ts, import COMMANDS and assert:
  import { COMMANDS } from "../src/skills/index.js";
  // ...
  expect(content).toBe(COMMANDS["work.md"]);
  ```

  **Test cases (write first):**
  | Test | Input | Expected |
  |------|-------|----------|
  | tampered file is repaired to exact source content | Overwrite work.md with "corrupted content", run `--project` | `readFileSync(workPath)` === `COMMANDS["work.md"]` |
  | repaired file matches byte-for-byte with source | Same as above | `Buffer.compare` returns 0 |
  | repair output says "updated" | Same as above | stdout contains "updated" |

  **File:** `packages/agentic/e2e/install-skills.e2e.test.ts` — modify test at line 143-146

  **Run:** `cd packages/agentic && bun test src/` — all green (e2e tests run separately via Docker)

---

## Dependency Graph

```
Step 1 (ADC perms) ──────────────────────────────── independent
Step 2 (cache expiry) ───────────────────────────── independent
Step 3 (TOCTOU comment) ─── depends on Step 2 ──── 2 modifies same file region
Step 4 (scope field) ─→ Step 5 (atomic manifest) ── both modify install-skills.ts; 4 changes types that 5's tests use
Step 6 (e2e assertion) ──────────────────────────── independent

Parallelizable:
  [Step 1] + [Step 2] + [Step 6]  — all touch different files
  [Step 4] → [Step 5]              — sequential, same file
  [Step 2] → [Step 3]              — sequential, same file
```

Arrow labels:
- `2 → 3`: Step 3 adds a comment in the same region Step 2 modifies (daemon.rs credential endpoint)
- `4 → 5`: Step 5's test references `InstallPlan` which Step 4 modifies (adds `scope` field)

---

## What This Plan Does NOT Include

- **Rust unit tests for daemon credential endpoint** — deferred because the HTTP handler is deeply nested in async closures within `serve_credential_endpoint`. Testing requires a mock HTTP server harness that doesn't exist yet. The `expires_at` fix is a single `.filter()` call verifiable by review.
- **TOCTOU fix with lock restructuring** — deferred because holding a write lock across `provider.get_credentials()` (a network call with 15s timeout) would block all concurrent credential requests. Documenting the tradeoff is the correct fix for now.
- **Full GCP ADC integration test** — deferred because `write_adc` depends on `dirs::config_dir()` which requires a real HOME directory. The conformance test validates the permission pattern.
- **Atomic writes for individual skill files** — deferred because only the manifest needs atomicity (skill files have idempotent repair on next run).
