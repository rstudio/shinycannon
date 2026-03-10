# Human Review Log

Items flagged during the TypeScript rewrite for human review after completion.

---

## 1. url.ts trailing slash normalization

- **What:** `httpToWs`, `clearQueryParams`, and `appendPath` strip trailing slashes from URLs via `replace(/\/$/, "")`. This is because `new URL("http://example.com").toString()` produces `"http://example.com/"` which differs from the Kotlin behavior that preserves the original input.
- **Where:** `src/url.ts:37,46,55`
- **What I decided:** Keep the trailing slash stripping. It's harmless in practice because `joinPaths` correctly handles slash joining regardless of whether the base URL has a trailing slash.
- **Why it needs review:** Verify this doesn't cause issues with any edge cases in URL construction during session playback (e.g., SockJS URLs that might be sensitive to trailing slashes).

## 2. http.ts cookie handling with redirects

- **What:** Cookies are persisted against the original request URL, not the final response URL after redirects. Redirect-chain `Set-Cookie` headers may not be fully captured.
- **Where:** `src/http.ts` (request method, cookie handling)
- **What I decided:** Keep current behavior. Node.js `fetch` with `redirect: "follow"` follows redirects automatically but only exposes the final response's headers. The Kotlin original also uses the request URL for cookie storage.
- **Why it needs review:** If apps behind load balancers set cookies during redirect chains, those cookies might be lost. Test with real Connect/SSP deployments to confirm.

## 3. Worker shutdown has no cancellation mechanism

- **What:** Workers check `keepWorking` only between complete session replays. If a session is in progress (especially blocked on `WS_RECV`), the worker cannot observe the shutdown signal until the session completes. A slow or hanging session blocks shutdown indefinitely.
- **Where:** `src/worker.ts:128` (the `while (keepWorking)` loop), `src/websocket.ts` (receive poll loop)
- **What I decided:** Keep current behavior. The Kotlin original has the same design — workers check between sessions, not mid-session. Adding `AbortController` cancellation would require threading a signal through `runSession`, all event handlers, and the WebSocket receive loop — a significant change beyond the 1:1 rewrite scope.
- **Why it needs review:** Consider adding cancellation as a post-rewrite enhancement. In practice, sessions are typically short (seconds to minutes), so shutdown delay is bounded. But a dead WebSocket with no server-side close could block indefinitely.

## 4. Logger performance with --debug-log

- **What:** The logger uses `fs.appendFileSync` on every message, opening and closing the file each time. Under high concurrency with `--debug-log` enabled, this generates many file operations.
- **Where:** `src/logger.ts:75`
- **What I decided:** Keep current behavior. The Kotlin original also writes synchronously. The debug log is an opt-in diagnostic tool, not a default.
- **Why it needs review:** Consider switching to a persistent file descriptor (like `SessionWriter` uses) if debug log performance becomes an issue in practice.

## 5. Token extraction trims response body (intentional divergence)

- **What:** `extractToken()` in `http.ts:66` calls `body.trim()` before storing the TOKEN value. The Kotlin original stores the raw response body without trimming.
- **Where:** `src/http.ts:65-67`
- **What I decided:** Keep the trim. Server responses commonly include trailing newlines, and a token with trailing whitespace would cause silent URL mismatches. Trimming is the safer default.
- **Why it needs review:** If any server returns a token that intentionally includes whitespace, this would break. Confirm with real Connect/SSP deployments.

## 6. Token validation is lenient (intentional divergence)

- **What:** Kotlin's `replaceTokens` scans for all `${TOKEN_NAME}` patterns (uppercase + underscore only), validates they are in the allowed set, and throws on unknowns. TypeScript iterates only over the allowed set and replaces matches, silently ignoring unrecognized `${...}` patterns. This was intentionally changed to handle `${...}` patterns in JavaScript template literals found in minified widget code (e.g., shinywidgets).
- **Where:** `src/tokens.ts:17-36`
- **What I decided:** Keep lenient behavior. The Kotlin regex `[A-Z_]+` wouldn't match JS template literals like `${e}` anyway, but modern widget code may include uppercase patterns that could collide. The tradeoff is losing early detection of misspelled tokens (e.g., `${SESION}`).
- **Why it needs review:** Decide if adding an uppercase-only regex check (matching Kotlin's `[A-Z_]+` pattern) to validate unknown tokens is worth the risk of false positives with widget code. Could also be a `--strict-tokens` flag.

## 7. fsyncSync on every CSV row write

- **What:** `SessionWriter.writeLine()` calls `fs.fsyncSync(this.fd)` after every CSV row, forcing a disk flush. Under high worker counts, this could become an I/O bottleneck.
- **Where:** `src/output.ts:112`
- **What I decided:** Keep current behavior for data safety. Session CSV files are the primary output of a load test, and losing data to a crash would be worse than slow writes.
- **Why it needs review:** Profile under high worker counts (50+) to see if this is a real bottleneck. Consider fsyncing on close only, or batching writes.
