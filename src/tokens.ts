import { randomBytes } from "node:crypto";

const TOKEN_PATTERN = /\$\{([A-Z_]+)}/g;

/**
 * Generate a cryptographically random hex string of the given length.
 */
export function randomHexString(length: number): string {
  const bytes = randomBytes(Math.ceil(length / 2));
  return bytes.toString("hex").substring(0, length);
}

/**
 * Extract all `${TOKEN_NAME}` placeholders from a string.
 */
export function getTokens(s: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of s.matchAll(TOKEN_PATTERN)) {
    const name = match[1];
    if (name !== undefined) {
      tokens.add(name);
    }
  }
  return tokens;
}

/**
 * Replace all `${TOKEN_NAME}` placeholders in `s` with values from
 * `tokenDictionary`. Throws if any token is not in `allowedTokens` or
 * if a token is allowed but missing from the dictionary.
 */
export function replaceTokens(
  s: string,
  allowedTokens: ReadonlySet<string>,
  tokenDictionary: ReadonlyMap<string, string>,
): string {
  const tokensInString = getTokens(s);

  const illegalTokens = [...tokensInString].filter(
    (t) => !allowedTokens.has(t),
  );
  if (illegalTokens.length > 0) {
    throw new Error(`${JSON.stringify(illegalTokens)} are illegal tokens`);
  }

  let result = s;
  for (const tokenName of tokensInString) {
    const value = tokenDictionary.get(tokenName);
    if (value === undefined) {
      throw new Error(
        `${tokenName} is an allowed token, but it isn't present in the dictionary`,
      );
    }
    result = result.replaceAll(`\${${tokenName}}`, value);
  }
  return result;
}

/**
 * Create an initial token dictionary with generated ROBUST_ID and SOCKJSID.
 */
export function createTokenDictionary(): Map<string, string> {
  return new Map([
    ["ROBUST_ID", randomHexString(18)],
    ["SOCKJSID", "000/" + randomHexString(8)],
  ]);
}
