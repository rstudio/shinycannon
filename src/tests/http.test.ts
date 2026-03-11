import { describe, it, expect } from "vitest"
import {
  statusEquals,
  validateStatus,
  extractWorkerId,
  extractToken,
} from "../http.js"

describe("statusEquals", () => {
  it("200 equals 200", () => {
    expect(statusEquals(200, 200)).toBe(true)
  })
  it("200 equals 304", () => {
    expect(statusEquals(200, 304)).toBe(true)
  })
  it("304 equals 200", () => {
    expect(statusEquals(304, 200)).toBe(true)
  })
  it("304 equals 304", () => {
    expect(statusEquals(304, 304)).toBe(true)
  })
  it("200 does not equal 403", () => {
    expect(statusEquals(200, 403)).toBe(false)
  })
  it("404 does not equal 200", () => {
    expect(statusEquals(404, 200)).toBe(false)
  })
  it("500 does not equal 200", () => {
    expect(statusEquals(500, 200)).toBe(false)
  })
})

describe("validateStatus", () => {
  it("does not throw when status matches", () => {
    expect(() =>
      validateStatus(200, 200, "http://example.com", "ok"),
    ).not.toThrow()
  })
  it("does not throw for 200/304 equivalence", () => {
    expect(() =>
      validateStatus(200, 304, "http://example.com", "ok"),
    ).not.toThrow()
  })
  it("throws when status does not match", () => {
    expect(() =>
      validateStatus(200, 403, "http://example.com/app", "Forbidden"),
    ).toThrow("Status 403 received, expected 200")
  })
  it("includes URL in error message", () => {
    expect(() =>
      validateStatus(200, 500, "http://example.com/app", "err"),
    ).toThrow("http://example.com/app")
  })
  it("truncates long body in error message", () => {
    const longBody = "x".repeat(300)
    try {
      validateStatus(200, 500, "http://example.com", longBody)
      expect.unreachable("should have thrown")
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain("...")
      expect(msg.length).toBeLessThan(longBody.length + 100)
    }
  })
})

describe("extractWorkerId", () => {
  it("extracts worker ID from base href", () => {
    const html =
      '<html><head><base href="_w_abc123/"></head><body>...</body></html>'
    expect(extractWorkerId(html)).toBe("abc123")
  })
  it("returns null when no base href", () => {
    expect(extractWorkerId("<html><body>hello</body></html>")).toBeNull()
  })
  it("extracts from multiline HTML", () => {
    const html = '<html>\n<head>\n<base href="_w_deadbeef/">\n</head></html>'
    expect(extractWorkerId(html)).toBe("deadbeef")
  })
  it("returns null for malformed base href", () => {
    const html = '<html><head><base href="_w_/"></head></html>'
    expect(extractWorkerId(html)).toBeNull()
  })
})

describe("extractToken", () => {
  it("trims whitespace", () => {
    expect(extractToken("  abc123  \n")).toBe("abc123")
  })
  it("returns empty string for whitespace-only input", () => {
    expect(extractToken("   \n\t  ")).toBe("")
  })
  it("returns token unchanged when no whitespace", () => {
    expect(extractToken("mytoken")).toBe("mytoken")
  })
})
