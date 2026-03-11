import { randomBytes } from "node:crypto"

/**
 * Generate a cryptographically random hex string of the given length.
 */
export function randomHexString(length: number): string {
  const bytes = randomBytes(Math.ceil(length / 2))
  return bytes.toString("hex").substring(0, length)
}

/**
 * Replace allowed `${TOKEN_NAME}` placeholders in `s` with values from
 * `tokenDictionary`. Only replaces tokens in the allowed set; other
 * `${...}` patterns (e.g. JavaScript template literals in minified
 * widget code) are left as-is.
 */
export function replaceTokens(
  s: string,
  allowedTokens: ReadonlySet<string>,
  tokenDictionary: ReadonlyMap<string, string>,
): string {
  let result = s
  for (const tokenName of allowedTokens) {
    const placeholder = `\${${tokenName}}`
    if (result.includes(placeholder)) {
      const value = tokenDictionary.get(tokenName)
      if (value === undefined) {
        throw new Error(
          `${tokenName} is an allowed token, but it isn't present in the dictionary`,
        )
      }
      result = result.replaceAll(placeholder, value)
    }
  }
  return result
}

/**
 * Create an initial token dictionary with generated ROBUST_ID and SOCKJSID.
 */
export function createTokenDictionary(): Map<string, string> {
  return new Map([
    ["ROBUST_ID", randomHexString(18)],
    ["SOCKJSID", "000/" + randomHexString(8)],
  ])
}
