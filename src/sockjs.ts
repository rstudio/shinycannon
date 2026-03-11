// SockJS message parsing and filtering.
// Shiny uses SockJS as a WebSocket transport layer. Messages arrive in
// different framing formats depending on the server type and whether
// reconnect support is enabled. This module normalizes, parses, and
// filters those messages.

// Reconnect-enabled message ID pattern (e.g. "A3#" in a["A3#0|m|..."])
const RECONNECT_ID_RE = /^a\["[0-9A-F]+#/

// SockJS a-frame pattern after normalization
const AFRAME_RE = /^a\["(\*#)?0\|m\|(.*?)"\]$/

// Patterns for messages that can be ignored outright
const IGNORABLE_REGEXES = [/^a\["ACK/, /^\["ACK/, /^h$/]

// Keys whose presence in a parsed message means it can be ignored
const IGNORABLE_KEYS = new Set(["busy", "progress", "recalculating"])

/**
 * Normalize reconnect-enabled message IDs to "*" for deterministic matching.
 * Replaces e.g. `a["A3#` with `a["*#`.
 */
export function normalizeMessage(msg: string): string {
  return msg.replace(RECONNECT_ID_RE, 'a["*#')
}

/**
 * Parse a SockJS-framed message into a JSON object.
 *
 * Message formats:
 * - Dev/SSO: raw JSON `{payload}`
 * - SSP/Connect, reconnect disabled: `a["0|m|{payload}"]`
 * - SSP/Connect, reconnect enabled: `a["A3#0|m|{payload}"]`
 *
 * Returns `null` for the SockJS open frame ("o").
 */
export function parseMessage(msg: string): Record<string, unknown> | null {
  if (msg === "o") {
    return null
  }

  const normalized = normalizeMessage(msg)
  const match = AFRAME_RE.exec(normalized)

  if (match) {
    // group 2 is the JSON-escaped payload inside the a-frame
    const escaped = match[2]!
    // Unescape by wrapping in quotes and parsing as a JSON string
    const inner = JSON.parse(`"${escaped}"`) as string
    return JSON.parse(inner) as Record<string, unknown>
  }

  // Dev/SSO format: raw JSON
  return JSON.parse(msg) as Record<string, unknown>
}

/**
 * Determine whether a SockJS message can be ignored during playback.
 *
 * Ignored messages include ACKs, heartbeats, busy/progress/recalculating
 * notifications, reactlog custom messages, and empty update messages.
 */
export function canIgnore(message: string): boolean {
  // Step 1: regex-based ignoring
  for (const re of IGNORABLE_REGEXES) {
    if (re.test(message)) return true
  }

  // Step 2: SockJS open frame is not ignorable
  if (message === "o") return false

  // Step 3: parse message
  const parsed = parseMessage(message)
  if (parsed === null) {
    throw new Error(`Expected to be able to parse message: ${message}`)
  }

  // Step 4: keys-based ignoring
  const keys = Object.keys(parsed)
  for (const key of keys) {
    if (IGNORABLE_KEYS.has(key)) return true
  }

  // Step 5: reactlog custom message
  if (
    keys.length === 1 &&
    keys[0] === "custom" &&
    typeof parsed["custom"] === "object" &&
    parsed["custom"] !== null
  ) {
    const customKeys = Object.keys(parsed["custom"] as Record<string, unknown>)
    if (customKeys.length === 1 && customKeys[0] === "reactlog") return true
  }

  // Step 6: empty update message (exact match: all three fields are empty arrays)
  if (keys.length === 3) {
    const errors = parsed["errors"]
    const values = parsed["values"]
    const inputMessages = parsed["inputMessages"]
    if (
      Array.isArray(inputMessages) &&
      inputMessages.length === 0 &&
      Array.isArray(errors) &&
      errors.length === 0 &&
      Array.isArray(values) &&
      values.length === 0
    ) {
      return true
    }
  }

  return false
}
