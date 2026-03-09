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
