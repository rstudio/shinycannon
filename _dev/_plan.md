# shinycannon Rewrite: Implementation Plan

> **Language:** TypeScript
> **Runtime:** Node.js 20+
> **Distribution:** npm (`npx shinycannon`)
> **Spec:** `_dev/00-spec-shinycannon.md`
> **Research:** `_dev/01-research-typescript.md`, `_dev/02-comparison.md`

---

## Decision Record

**We are rewriting shinycannon in TypeScript, targeting Node.js 20+, distributed
as an npm package.**

Rationale:

- **Team fluency.** Our team works primarily in TypeScript. This means
  idiomatic code from day one, faster reviews, easier maintenance, and a larger
  pool of contributors.
- **Distribution simplicity.** `npm publish` replaces the entire Docker + Maven
  + fpm pipeline. No cross-compilation, no platform matrix, no build
  containers.
- **Adequate concurrency.** shinycannon is purely I/O-bound. Node.js's async
  event loop handles thousands of concurrent connections -- the target Shiny app
  will be the bottleneck, never the load generator.
- **Type safety.** TypeScript with strict mode gives us type-driven development
  with compile-time feedback across the entire codebase. This is a core value
  of the rewrite, not a nice-to-have.

---

## Technology Stack

| Component | Choice | Why |
|-----------|--------|-----|
| Runtime | Node.js 20+ (LTS) | Ubiquitous, proven, LTS guarantees |
| Language | TypeScript 5.x, strict mode | Type safety is a primary goal |
| WebSocket | `ws` | Only Node.js WebSocket client supporting custom headers on upgrade (required for cookie/auth forwarding) |
| HTTP | Built-in `fetch` + `tough-cookie` | fetch is standard; tough-cookie provides per-session RFC 6265 cookie jar |
| CLI | `commander` | 28k stars, 120M weekly downloads, full TypeScript types |
| Build | `tsup` (esbuild) | Fast, produces ESM, used by major CLI tools (wrangler) |
| Dev runner | `tsx` | Run TypeScript directly during development, no build step |
| Test | `vitest` | Fast, TypeScript-native, Jest-compatible API |
| Lint | `eslint` + `@typescript-eslint` | Standard |
| Format | `prettier` | Standard |

### Runtime Dependencies (3 total)

| Package | Weekly Downloads | Purpose |
|---------|-----------------|---------|
| `ws` | 176M | WebSocket client with custom headers |
| `tough-cookie` | 21.5M dependents | Per-session cookie jar |
| `commander` | 120M | CLI argument parsing |

Everything else is built-in (`fetch`, `URL`, `JSON`, `fs`, `crypto`) or custom
code (logger, CSV writer, SockJS parser, recording parser).

---

## Type System Philosophy

TypeScript's type system is a primary motivation for this rewrite. We should
leverage it fully:

- **`strict: true`** in tsconfig.json. No exceptions.
- **Discriminated unions** for event types. The recording event parser should
  produce a union type where each variant carries exactly the fields for that
  event type. Pattern matching via `switch (event.type)` gives exhaustiveness
  checking.
- **Branded types** where appropriate (e.g., `SessionId`, `WorkerId`,
  `Milliseconds`) to prevent mixing up numeric IDs. Keep this lightweight --
  only where confusion is likely.
- **Explicit types on module boundaries.** Public function signatures should
  have explicit return types. Let inference work inside function bodies.
- **No `any`.** Use `unknown` for truly dynamic data (e.g., raw JSON from
  WebSocket messages) and narrow with type guards.
- **Readonly where possible.** Session configuration, recording data, and token
  dictionaries should use `readonly` properties and `ReadonlyMap` /
  `ReadonlySet` where the data shouldn't be mutated after construction.

---

## Project Structure

```
shinycannon/
  _archive/
    kotlin/                   # Original source (reference during rewrite)
      src/
      pom.xml
      Makefile
      Dockerfile
      ...
  _dev/
    00-spec-shinycannon.md    # Feature spec
    01-research-*.md          # Technology research
    02-comparison.md          # Language comparison
    _plan.md                  # This document
  package.json
  tsconfig.json
  tsup.config.ts
  vitest.config.ts
  src/
    main.ts               # Entry point: #!/usr/bin/env node, parse CLI, run
    cli.ts                # CLI argument parsing and validation
    types.ts              # Core type definitions (events, recording, config)
    recording.ts          # Recording file parser
    tokens.ts             # Token dictionary and substitution
    sockjs.ts             # SockJS message parsing and filtering
    detect.ts             # Server type auto-detection
    auth.ts               # Authentication flows (SSP, Connect)
    http.ts               # HTTP client wrapper with cookie jar
    websocket.ts          # WebSocket client wrapper + message queue
    session.ts            # Single session playback (event loop)
    worker.ts             # Worker orchestration + endurance test
    output.ts             # CSV output and output directory management
    logger.ts             # Two-tier logging (console + debug file)
    url.ts                # URL manipulation helpers
  tests/
    recording.test.ts
    tokens.test.ts
    sockjs.test.ts
    detect.test.ts
    auth.test.ts
    session.test.ts
    worker.test.ts
```

---

## Implementation Phases

### Phase 0: Repository Reorganization ✅ COMPLETE

Archive the Kotlin source and build infrastructure to make room for the
TypeScript project. The Kotlin code is preserved on `main` and in git history;
archiving it on this branch keeps it accessible for reference during
implementation without cluttering the workspace.

**Move to `_archive/kotlin/`:**

- `src/` (Kotlin source and test files)
- `pom.xml` (Maven config)
- `Makefile` (fpm packaging)
- `Dockerfile` (build container)
- `shinycannon.iml` (IntelliJ project file)
- `shinycannon.1.ronn` (man page source)
- `head.sh` (self-extracting JAR preamble)

**Keep in place:**

- `_dev/` (spec, research, plan -- living documents)
- `README.md` and `NEWS.md` (updated in Phase 5)
- `.github/` (workflow replaced in Phase 5)
- `.gitignore` (updated for `node_modules/`, `dist/`)
- `.gitattributes`

**Result:** A clean root directory ready for `package.json`, `tsconfig.json`,
and `src/`.

**Milestone:** Single commit: "chore: archive Kotlin source for TypeScript
rewrite"

---

### Phase 1: Foundation ✅ COMPLETE

Set up the project scaffolding and implement the core data types and pure
logic modules that don't require I/O or network access. These are the easiest
to write, the easiest to test, and they establish the type vocabulary that
everything else builds on.

**Modules:**

- **Project setup.** package.json, tsconfig.json (strict), tsup, vitest,
  eslint, prettier. Establish the build and test pipeline from the start.
- **`types.ts`** -- Core type definitions. Discriminated union for recording
  events, recording header properties, server types, session configuration,
  credentials. This is the type backbone of the project.
- **`recording.ts`** -- Recording file parser. Read the file, parse headers
  (including legacy format upgrade), parse JSON event lines into the
  discriminated union. Validate version, validate last event is `WS_CLOSE`.
- **`tokens.ts`** -- Token dictionary and `replaceTokens()`. Generate random
  hex strings for `ROBUST_ID` and `SOCKJSID`. Validate that only allowed
  tokens appear in URLs/messages.
- **`sockjs.ts`** -- SockJS message parsing (`parseMessage`) and message
  filtering (`canIgnore`). Normalize reconnect-enabled message IDs.
  Parse the inner JSON payload from all framing variants.
- **`url.ts`** -- URL helpers: `httpToWs` scheme switching, path joining
  (relative recording URLs to app base URL), query parameter clearing.

**Tests:** Each module gets unit tests. The recording parser, token
substitution, SockJS parser, and message filtering logic all have clear
inputs and outputs that can be tested against the existing Kotlin test cases.

**Milestone:** `npm test` passes with full coverage of pure logic modules.

---

### Phase 2: Network Layer ✅ COMPLETE

Implement the HTTP and WebSocket clients, server detection, and
authentication. These modules handle all network I/O and are the bridge
between the recording events and the actual Shiny application.

**Modules:**

- **`http.ts`** -- HTTP client wrapper around `fetch` + `tough-cookie`.
  Per-session cookie jar, custom header injection, user-agent. GET with
  status validation (200/304 equivalence). POST with form-encoded body.
  POST with file body. Worker ID extraction from `REQ_HOME` response HTML.
  Token extraction from `REQ_TOK` response body.
- **`websocket.ts`** -- WebSocket client wrapper around `ws`. Open connection
  with custom headers and cookies from the session's cookie jar. Message
  receive queue (`AsyncQueue` with capacity 50). Message filtering via
  `canIgnore`. Error and disconnect handling that propagates failure to the
  session. Send text messages. Close connection.
- **`detect.ts`** -- Server type auto-detection. Make a GET to the app URL,
  inspect hostname, response headers, cookies, and body. Return typed
  `ServerType`.
- **`auth.ts`** -- Authentication flows. Connect API key header. Connect
  username/password JSON POST to `__login__`. SSP form login with hidden
  field extraction. Cookie retrieval for Connect API key routing.

**Tests:** Server detection and auth flows are hard to unit test without a
live server. Focus on:
- Testing the HTTP wrapper's cookie jar bridging with a local mock server
  (or by mocking fetch).
- Testing the WebSocket wrapper's message queue, filtering, and error
  propagation with a local WebSocket server or mocked ws instance.
- Testing auth URL construction and request formatting.
- Testing server type detection against recorded response fixtures.

**Milestone:** Can authenticate against a real Shiny app and open a WebSocket
connection.

---

### Phase 3: Session Playback ✅ COMPLETE

Implement single-session playback: walk through the recording events
sequentially, executing each one with correct timing.

**Modules:**

- **`output.ts`** -- Output directory creation, session CSV file writing,
  version file, recording file copy. The `printCsv` helper that writes
  timestamped event rows.
- **`logger.ts`** -- Two-tier logger. Console output at configurable level.
  Optional debug file at DEBUG level. Format:
  `yyyy-MM-dd HH:mm:ss.SSS LEVEL [worker-name] - message`. Child loggers
  with worker name context.
- **`session.ts`** -- The core session playback loop. Walk through the
  recording events. For each event: compute `sleepBefore`, sleep, check for
  failure, handle the event (dispatching to http/websocket modules), log
  timing to CSV. Handle `WS_RECV` by awaiting the message queue with 30s
  timeout + warning. Handle failure propagation from WebSocket callbacks.

**Tests:** Session playback against a mock/recorded sequence. Verify:
- Correct sleep timing between events
- CSV output contains expected event rows with plausible timestamps
- Failure propagation from WebSocket errors terminates the session
- Message queue overflow produces the expected error

**Milestone:** Can play back a recorded session against a live Shiny app and
produce correct CSV output.

---

### Phase 4: Worker Orchestration ✅ COMPLETE

Implement the endurance test: multiple workers, staggered start, loaded
duration, coordinated shutdown, progress reporting.

**Modules:**

- **`worker.ts`** -- EnduranceTest class (or equivalent). Launch N async
  worker functions with staggered start delays. Each worker loops: run a
  session, check if shutdown signaled, repeat. Shutdown signal via
  `AbortController` after loaded duration expires. Progress reporting via
  `setInterval` every 5 seconds. Stats tracking (running/done/failed counts).
  Final summary on completion.
- **`cli.ts`** -- CLI argument parsing with commander. Positional args
  (recording, app-url), named options (workers, loaded-duration-minutes,
  start-interval, output-dir, header, etc.), flags (overwrite-output,
  debug-log), environment variable credentials. Validation: recording file
  exists, output dir handling, start-interval default calculation.
- **`main.ts`** -- Entry point. Parse CLI, validate inputs, initialize
  logging, detect server type, validate recording compatibility, set up
  output directory, create and run endurance test.

**Tests:** Worker orchestration tests:
- Verify staggered start timing (N workers, each delayed by interval)
- Verify shutdown signal stops workers after loaded duration
- Verify workers complete their current session before stopping
- Verify progress stats are accurate
- Verify output directory structure is correct

**Milestone:** Full end-to-end: `npx tsx src/main.ts recording.log
https://example.com/app --workers 3 --loaded-duration-minutes 1` produces
correct output.

---

### Phase 5: Packaging & Release ✅ COMPLETE

Finalize the npm package for distribution.

- **Build pipeline.** `tsup` compiles to ESM JavaScript in `dist/`. The
  `bin` field in package.json points to `dist/main.js` with a
  `#!/usr/bin/env node` shebang.
- **package.json metadata.** Name, version, description, repository, license,
  engines (`>=20`), files (only `dist/`).
- **CI/CD.** GitHub Actions workflow: lint, test, build on PRs. Publish to
  npm on tag push (`v*`).
- **Version reporting.** Read version from package.json at runtime
  (import from package.json or embed at build time via tsup define).
- **README.** Installation and usage instructions. Migration guide from
  the Kotlin version.

**Milestone:** `npm publish` succeeds, `npx shinycannon --help` works.

---

## Behavioral Constraints Checklist

These must all be preserved from the original implementation (see spec
Section 10). Each should have an associated test:

- [ ] Recording must end with `WS_CLOSE` -- validated at startup
- [ ] 200/304 status codes treated as interchangeable
- [ ] WebSocket receive queue bounded at 50; overflow is fatal
- [ ] `WS_RECV` compares only top-level JSON keys
- [ ] Start interval defaults to `recording_duration / num_workers`
- [ ] Colons in timestamp-based output dir names replaced with underscores
- [ ] Recording file copied into output directory
- [ ] CLI arguments serialized to JSON in session CSV comments
- [ ] Server-initiated WebSocket close is a session failure
- [ ] SockJS `o` message is valid (returns null from parseMessage, not ignored)
- [ ] Reconnect-enabled message IDs normalized for matching
- [ ] Process exits cleanly when all work is complete

---

## Output Compatibility

The CSV output format must remain compatible with the shinyloadtest R package's
analysis functions. The column names, event names, and timestamp format must
match exactly:

```
# <cli args string>
# <cli args json>
session_id,worker_id,iteration,event,timestamp,input_line_number,comment
0,0,0,PLAYER_SESSION_CREATE,1704067200000,0,
0,0,0,REQ_HOME_START,1704067200001,2,
0,0,0,REQ_HOME_END,1704067200050,2,
...
```

- `timestamp` is Unix epoch milliseconds (`Date.now()`)
- `event` names use the exact same strings as the Kotlin version
- `input_line_number` is 1-based, matching the recording file

---

## What We Are NOT Doing

To keep the scope bounded:

- **Not changing the recording format.** The recording file format is owned by
  shinyloadtest (R package). We consume it as-is.
- **Not changing the output format.** The CSV format is consumed by
  shinyloadtest's analysis functions. Must be byte-compatible.
- **Not adding new features.** This is a 1:1 behavioral rewrite. New features
  (if any) come after the rewrite lands.
- **Not supporting sub-applications.** Same limitation as the original.
- **Not building a programmatic API.** CLI only, same as the original. (The
  module structure supports this later if desired, but it's not a goal.)
