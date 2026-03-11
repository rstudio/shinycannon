/**
 * Server type auto-detection.
 *
 * Determines which server type is hosting a Shiny application by
 * inspecting the hostname and the HTTP response from a GET to the app URL.
 */

import { ServerType } from "./types.js"
import type { HttpClient } from "./http.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if `body` contains a script reference to shiny.js or
 * shiny.min.js (e.g. `<script src="shared/shiny.min.js">`).
 */
export function hasShinyJs(body: string): boolean {
  return /\/shiny(\.min)?\.js["']/.test(body)
}

// Set of x-powered-by values that indicate SSP.
const SSP_POWERED_BY = new Set(["Express", "Shiny Server", "Shiny Server Pro"])

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect the server type for the given app URL.
 *
 * Detection order follows the original Kotlin implementation:
 *   1. Hostname check for shinyapps.io -> SAI
 *   2. Response header / cookie checks -> SSP or RSC
 *   3. Body check for shiny.js -> SHN
 *   4. Throw if nothing matched
 */
export async function detectServerType(
  appUrl: string,
  httpClient: HttpClient,
): Promise<ServerType> {
  // Step 1: hostname check
  const host = new URL(appUrl).hostname
  if (/^.*\.shinyapps\.io$/.test(host)) {
    return ServerType.SAI
  }

  // Step 2: fetch the app
  const resp = await httpClient.get(appUrl)

  // Step 3a: SSP via x-ssp-xsrf header
  if (resp.headers["x-ssp-xsrf"] !== undefined) {
    return ServerType.SSP
  }

  // Step 3b: SSP via SSP-XSRF cookie in set-cookie header
  const setCookie = resp.headers["set-cookie"] ?? ""
  if (/\bSSP-XSRF\b/.test(setCookie)) {
    return ServerType.SSP
  }

  // Step 3c: SSP via x-powered-by header
  const poweredBy = resp.headers["x-powered-by"]
  if (poweredBy !== undefined && SSP_POWERED_BY.has(poweredBy)) {
    return ServerType.SSP
  }

  // Step 3d: RSC via rscid cookie
  if (/\brscid\b/.test(setCookie)) {
    return ServerType.RSC
  }

  // Step 4: body check for shiny.js
  if (hasShinyJs(resp.body)) {
    return ServerType.SHN
  }

  // Step 5: nothing matched
  throw new Error(
    `Target URL ${appUrl} does not appear to be a Shiny application.`,
  )
}
