import { describe, it, expect } from "vitest"

import {
  randomHexString,
  replaceTokens,
  createTokenDictionary,
} from "../tokens.js"

const testUrl = "foo${LOL}bar${LMAO}"
const allowedTokens = new Set(["LOL", "DUCK", "LMAO"])
const urlDictionary = new Map([
  ["LOL", " funny! "],
  ["LMAO", " very funny!!! "],
])

describe("replaceTokens", () => {
  it("substitutes tokens correctly", () => {
    expect(replaceTokens(testUrl, allowedTokens, urlDictionary)).toBe(
      "foo funny! bar very funny!!! ",
    )
  })

  it("ignores unknown ${...} patterns (e.g. JS template literals)", () => {
    const s = "foo${LOL}bar${D}baz${E}"
    expect(replaceTokens(s, allowedTokens, urlDictionary)).toBe(
      "foo funny! bar${D}baz${E}",
    )
  })

  it("throws on missing dictionary entry for allowed token", () => {
    const s = "foo${DUCK}bar"
    expect(() => replaceTokens(s, allowedTokens, urlDictionary)).toThrowError(
      "isn't present in the dictionary",
    )
  })
})

describe("randomHexString", () => {
  it("produces string of correct length", () => {
    expect(randomHexString(10)).toHaveLength(10)
    expect(randomHexString(18)).toHaveLength(18)
    expect(randomHexString(1)).toHaveLength(1)
  })

  it("produces only hex characters", () => {
    const hex = randomHexString(100)
    expect(hex).toMatch(/^[0-9a-f]+$/)
  })
})

describe("createTokenDictionary", () => {
  it("has ROBUST_ID with 18 hex characters", () => {
    const dict = createTokenDictionary()
    const robustId = dict.get("ROBUST_ID")
    expect(robustId).toBeDefined()
    expect(robustId).toHaveLength(18)
    expect(robustId).toMatch(/^[0-9a-f]+$/)
  })

  it("has SOCKJSID starting with '000/'", () => {
    const dict = createTokenDictionary()
    const sockjsId = dict.get("SOCKJSID")
    expect(sockjsId).toBeDefined()
    expect(sockjsId).toMatch(/^000\/[0-9a-f]{8}$/)
  })
})
