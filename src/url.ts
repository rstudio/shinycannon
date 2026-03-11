/**
 * URL manipulation helpers for session playback.
 */

/**
 * Join two path segments, handling trailing/leading slashes at the junction.
 */
export function joinPaths(base: string, path: string): string {
  const baseEnds = base.endsWith("/")
  const pathStarts = path.startsWith("/")

  if (baseEnds && pathStarts) {
    return base + path.substring(1)
  }
  if (baseEnds || pathStarts) {
    return base + path
  }
  return base + "/" + path
}

/**
 * Convert an HTTP(S) URL to its WebSocket equivalent (ws/wss)
 * and clear any query parameters.
 */
export function httpToWs(url: string): string {
  const parsed = new URL(url)

  if (parsed.protocol === "http:") {
    parsed.protocol = "ws:"
  } else if (parsed.protocol === "https:") {
    parsed.protocol = "wss:"
  } else {
    throw new Error(`Unknown scheme: ${parsed.protocol.replace(":", "")}`)
  }

  parsed.search = ""
  return parsed.toString().replace(/\/$/, "") || parsed.toString()
}

/**
 * Remove query parameters from a URL, preserving everything else.
 */
export function clearQueryParams(url: string): string {
  const parsed = new URL(url)
  parsed.search = ""
  return parsed.toString().replace(/\/$/, "") || parsed.toString()
}

/**
 * Append a relative path to a base URL using joinPaths logic.
 */
export function appendPath(baseUrl: string, path: string): string {
  const parsed = new URL(baseUrl)
  parsed.pathname = joinPaths(parsed.pathname, path)
  return parsed.toString().replace(/\/$/, "") || parsed.toString()
}
