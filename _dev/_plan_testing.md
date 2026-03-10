# Automated Testing Plan

> **Goal:** Increase automated test coverage from 104 unit tests to ~150+,
> covering CLI behavior, integration flows, and behavioral constraints.
> References `_dev/qa-test-plan.md` test IDs throughout.

---

## Current State

- **104 tests** across 9 test files covering pure logic modules
- No integration tests (CLI process spawning, end-to-end session playback)
- No mock Shiny server for network-level testing

---

## Tier 1: Unit & CLI Tests (no mock server needed)

These tests spawn `node dist/main.js` as a subprocess or test exported
functions directly. No network access required.

### 1.1 CLI Process Tests — `src/tests/cli-process.test.ts`

Spawn the built CLI as a child process and assert on exit code, stdout,
and stderr.

**Prerequisite:** `npm run build` must succeed before these tests run.
Configure vitest to run build first, or mark these as integration tests
in a separate test config.

| QA Test ID | What to test | Assertion |
|------------|-------------|-----------|
| CLI-01 | `--help` | Exit 0, stdout contains `Usage:`, lists all options |
| CLI-02 | `--version` | Exit 0, stdout matches `/^\d+\.\d+\.\d+/` |
| CLI-04 | `--workers 0` | Exit non-zero, stderr contains "Invalid" |
| CLI-04 | `--workers abc` | Exit non-zero, stderr contains "Invalid" |
| CLI-04 | `--workers 1.5` | Exit non-zero, stderr contains "Invalid" |
| CLI-16 | Missing recording file | Exit non-zero, stderr contains "not found" |
| CLI-17 | Missing app URL (1 arg only) | Exit non-zero |
| CLI-18 | No arguments | Exit non-zero |

**Implementation notes:**
- Use `child_process.execFile` or `execa` to spawn `node dist/main.js`
- Tests that require a recording file: create a temp valid recording in
  `beforeAll`, clean up in `afterAll`
- Tests that DON'T touch the network can use a fake app URL

### 1.2 CLI Parsing Unit Tests — `src/tests/cli.test.ts`

Test `parseArgs()`, `parseHeader()`, and `serializeArgs()` directly.

| QA Test ID | What to test | Assertion |
|------------|-------------|-----------|
| CLI-08/09 | `parseHeader("X-Foo: bar")` | Returns `["X-Foo", "bar"]` |
| CLI-08 | `parseHeader("malformed")` | Throws |
| CLI-08 | `parseHeader(": no-name")` | Throws |
| CLI-07 | `serializeArgs(...)` round-trip | argsString and argsJson contain expected fields |
| — | `parseLogLevel("debug")` | Returns `LogLevel.DEBUG` |
| — | `parseLogLevel("INVALID")` | Throws |

### 1.3 Recording Validation Tests — extend `src/tests/recording.test.ts`

Most of these are already covered. Add any missing cases:

| QA Test ID | What to test | Status |
|------------|-------------|--------|
| REC-01 | Valid v1 recording parsed | ✅ Exists |
| REC-02 | Legacy format auto-upgrade | ✅ Exists |
| REC-03 | Version > 1 rejected | ✅ Exists |
| REC-04 | Missing WS_CLOSE rejected | ✅ Exists |
| REC-05 | Empty recording rejected | ✅ Exists |
| — | Invalid begin timestamp (NaN) | **Add** |
| — | Negative version rejected | **Add** (dead code, but confirm) |

### 1.4 Server Detection Tests — extend `src/tests/detect.test.ts`

| QA Test ID | What to test | Status |
|------------|-------------|--------|
| DET-01 | shinyapps.io hostname → SAI | ✅ Exists |
| DET-02 | x-ssp-xsrf header → SSP | ✅ Exists |
| DET-03 | rscid cookie → RSC | ✅ Exists |
| DET-04 | shiny.js in body → SHN | ✅ Exists |
| DET-05 | No match → throws | ✅ Exists |
| DET-06 | x-powered-by: Express → SSP | **Add** |

### 1.5 Behavioral Constraint Tests

Most are already covered. Verify and fill gaps:

| Constraint | Test file | Status |
|-----------|-----------|--------|
| WS_CLOSE must be last event | recording.test.ts | ✅ |
| 200/304 equivalence | http.test.ts | ✅ |
| Queue bounded at 50 | websocket.test.ts | ✅ |
| WS_RECV compares top-level keys | sockjs.test.ts | ✅ |
| SockJS `o` returns null | sockjs.test.ts | ✅ |
| Reconnect IDs normalized | sockjs.test.ts | ✅ |
| Colons replaced in output dir | output.test.ts | ✅ |
| Recording copied to output | output.test.ts | ✅ |
| Start interval default | **cli.test.ts — Add** | ❌ |
| Server-initiated close is failure | websocket.test.ts | ✅ |

---

## Tier 2: Integration Tests (mock Shiny server)

These tests require a lightweight mock server that simulates the Shiny
protocol. This unlocks ~26 additional QA tests.

### 2.1 MockShinyServer — `src/tests/helpers/mock-shiny-server.ts`

A minimal HTTP + WebSocket server that implements the Shiny handshake:

```
GET /           → 200 HTML with <base href="_w_abc123/">
GET /__sockjs__ → 200 server info JSON
GET /__token__  → 200 "token-value"
WS  /websocket  → accepts, sends init message with sessionId,
                   echoes back WS_RECV responses, handles close
```

**Design:**
- Extends Node.js `http.createServer` + `ws.WebSocketServer`
- Listens on `localhost:0` (random port)
- Configurable: delay responses, return errors, drop connections
- `start()` / `stop()` lifecycle for vitest `beforeAll`/`afterAll`
- Returns a valid recording fixture that matches its endpoints

**Estimated size:** ~150 lines

### 2.2 Session Playback Integration — `src/tests/session-integration.test.ts`

Uses MockShinyServer to test full session playback:

| QA Test ID | What to test |
|------------|-------------|
| PLAY-01 | Single worker completes a session, CSV has correct event sequence |
| PLAY-02 | Multiple workers start staggered (verify timestamps) |
| PLAY-03 | CSV column names match spec |
| PLAY-04 | CSV comment lines contain args string and valid JSON |
| PLAY-05 | Event names match exactly (REQ_HOME_START, REQ_HOME_END, etc.) |
| PLAY-06 | Timestamps are epoch milliseconds, monotonically increasing |
| PLAY-07 | input_line_number matches recording file lines |
| PLAY-08 | Session file naming: `{session}_{worker}_{iteration}.csv` |
| OUT-01 | Output dir has sessions/, recording.log, version.txt |

### 2.3 Worker Orchestration Integration — `src/tests/worker-integration.test.ts`

Uses MockShinyServer with fast sessions (~50ms each):

| QA Test ID | What to test |
|------------|-------------|
| END-01 | All workers complete warmup before loaded duration starts |
| END-02 | Workers loop (iteration > 0 in CSV filenames) |
| END-03 | Shutdown after loaded duration (within tolerance) |
| END-04 | Workers finish current session before stopping |
| END-05 | Progress reporting logged every ~5s (verify with mock logger) |
| END-06 | Final summary includes correct done/failed counts |
| CLI-03 | `--workers 3` produces 3 concurrent workers |
| CLI-05 | `--loaded-duration-minutes 0.01` runs for ~600ms |
| CLI-06 | `--start-interval 100` staggers by ~100ms |

### 2.4 Error Handling Integration — `src/tests/error-handling.test.ts`

Configure MockShinyServer to simulate failures:

| QA Test ID | What to test | Mock behavior |
|------------|-------------|---------------|
| ERR-01 | App is down | Don't start mock server, use bad port |
| ERR-02 | HTTP status mismatch | Return 500 for REQ_HOME |
| ERR-03 | 200/304 equivalence | Return 304 for REQ_HOME (recording expects 200) |
| ERR-04 | WebSocket disconnect | Server closes WS mid-session |
| ERR-05 | WS_RECV timeout warning | Server delays WS response > 30s |
| ERR-06 | Process exit code 1 on failure | Spawn CLI against bad URL |

### 2.5 Auth Integration — `src/tests/auth-integration.test.ts`

Mock server with auth endpoints:

| QA Test ID | What to test | Mock behavior |
|------------|-------------|---------------|
| AUTH-05 | Creds set but app is open | Mock returns 200 (not 403), verify warning logged |
| AUTH-06 | rscApiKeyRequired but no key | Use fixture recording, verify error |
| — | Connect API key sent on HTTP | Mock verifies `Authorization: Key` header |
| — | Headers propagated after login | Mock verifies custom headers on post-login requests |

---

## Tier 3: Manual Only (5 tests)

These require real server infrastructure and cannot be automated in CI:

| QA Test ID | Why manual |
|------------|-----------|
| AUTH-02 | Needs real SSP with PAM authentication |
| AUTH-03 | Needs real Connect with API key |
| AUTH-04 | Needs real Connect with username/password |
| AUTH-08 | Needs real Connect URL routing behavior |
| OUT-02 | Needs R + shinyloadtest `load_runs()` to verify CSV parsing |

These stay in `_dev/qa-test-plan.md` as manual checkboxes.

---

## Implementation Order

### Phase A: Tier 1 (no new infrastructure) ✅

1. ✅ **cli.test.ts** — 16 tests: parseHeader, serializeArgs, parseLogLevel, parseArgs
2. ✅ **cli-process.test.ts** — 9 tests: --help, --version, invalid workers, missing args
3. ✅ Fill gaps: invalid timestamp (NaN), negative version, x-powered-by SSP

**Result:** 28 new tests (104 → 132)

### Phase B: Mock Server + Tier 2 ✅

1. ✅ **mock-shiny-server.ts** — HTTP+WS mock server helper (~225 lines)
2. ✅ **session-integration.test.ts** — 8 tests: event sequence, CSV format, timestamps, line numbers
3. ✅ **worker-integration.test.ts** — 6 tests: multi-worker, iteration looping, timing, staggering
4. ✅ **error-handling.test.ts** — 5 tests: connection refused, HTTP mismatch, WS disconnect
5. ✅ **auth-integration.test.ts** — 4 tests: creds warning, API key flow, no-auth flow

**Result:** 23 new tests (132 → 155)

### Phase C: CI Configuration ✅

- ✅ `npm test` runs both unit and integration tests (single vitest config)
- ✅ vitest.config.ts updated with 30s testTimeout
- No separate config needed — all 155 tests run in ~7s

---

## Success Criteria

- ✅ `npm test` passes with 155 tests (target: ~150+)
- ✅ All Tier 1 QA test IDs have automated coverage
- ✅ All Tier 2 QA test IDs have automated coverage via mock server
- ✅ No flaky tests (timing tests use generous tolerances)
- ⬜ CI (GitHub Actions) runs all tests on every PR (not yet configured)
