# Human Review Log

Items flagged during the TypeScript rewrite for human review after completion.

---

## 1. url.ts trailing slash normalization

- **What:** `httpToWs`, `clearQueryParams`, and `appendPath` strip trailing slashes from URLs via `replace(/\/$/, "")`. This is because `new URL("http://example.com").toString()` produces `"http://example.com/"` which differs from the Kotlin behavior that preserves the original input.
- **Where:** `src/url.ts:37,46,55`
- **What I decided:** Keep the trailing slash stripping. It's harmless in practice because `joinPaths` correctly handles slash joining regardless of whether the base URL has a trailing slash.
- **Why it needs review:** Verify this doesn't cause issues with any edge cases in URL construction during session playback (e.g., SockJS URLs that might be sensitive to trailing slashes).
