import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  loginUrlFor,
  extractHiddenInputs,
  connectApiKeyHeader,
  getCreds,
} from "../auth.js"
import { ServerType } from "../types.js"

describe("loginUrlFor", () => {
  it("appends __login__ for RSC", () => {
    expect(
      loginUrlFor("https://connect.example.com/content/123", ServerType.RSC),
    ).toBe("https://connect.example.com/content/123/__login__")
  })
  it("appends __login__ for SSP", () => {
    expect(loginUrlFor("https://ssp.example.com/app", ServerType.SSP)).toBe(
      "https://ssp.example.com/app/__login__",
    )
  })
  it("handles trailing slash", () => {
    expect(
      loginUrlFor("https://connect.example.com/content/123/", ServerType.RSC),
    ).toBe("https://connect.example.com/content/123/__login__")
  })
  it("throws for unsupported server type", () => {
    expect(() => loginUrlFor("http://example.com", ServerType.SHN)).toThrow()
  })
  it("throws for UNK server type", () => {
    expect(() => loginUrlFor("http://example.com", ServerType.UNK)).toThrow()
  })
  it("throws for SAI server type", () => {
    expect(() => loginUrlFor("http://example.com", ServerType.SAI)).toThrow()
  })
})

describe("extractHiddenInputs", () => {
  it("extracts hidden inputs from HTML", () => {
    const html = `
      <form>
        <input type="hidden" name="csrf_token" value="abc123">
        <input type="hidden" name="redirect" value="/app">
        <input type="text" name="username">
      </form>`
    const inputs = extractHiddenInputs(html)
    expect(inputs).toEqual({ csrf_token: "abc123", redirect: "/app" })
  })
  it("returns empty object when no hidden inputs", () => {
    expect(extractHiddenInputs("<form><input type='text'></form>")).toEqual({})
  })
  it("handles single quotes", () => {
    const html = "<input type='hidden' name='token' value='xyz'>"
    expect(extractHiddenInputs(html)).toEqual({ token: "xyz" })
  })
  it("handles input with no value attribute", () => {
    const html = "<input type='hidden' name='empty'>"
    expect(extractHiddenInputs(html)).toEqual({ empty: "" })
  })
  it("handles empty HTML", () => {
    expect(extractHiddenInputs("")).toEqual({})
  })
  it("ignores non-hidden inputs", () => {
    const html = `
      <input type="text" name="user" value="bob">
      <input type="password" name="pass" value="secret">
      <input type="hidden" name="csrf" value="tok">`
    expect(extractHiddenInputs(html)).toEqual({ csrf: "tok" })
  })
})

describe("connectApiKeyHeader", () => {
  it("returns Authorization header", () => {
    expect(connectApiKeyHeader("my-api-key")).toEqual({
      Authorization: "Key my-api-key",
    })
  })
  it("includes full key in header value", () => {
    const header = connectApiKeyHeader("abc-123-def")
    expect(header["Authorization"]).toBe("Key abc-123-def")
  })
})

describe("getCreds", () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env["SHINYLOADTEST_USER"]
    delete process.env["SHINYLOADTEST_PASS"]
    delete process.env["SHINYLOADTEST_CONNECT_API_KEY"]
    delete process.env["SHINYCANNON_USER"]
    delete process.env["SHINYCANNON_PASS"]
    delete process.env["SHINYCANNON_CONNECT_API_KEY"]
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("returns nulls when no env vars are set", () => {
    const creds = getCreds()
    expect(creds).toEqual({ user: null, pass: null, connectApiKey: null })
  })

  it("reads user and pass from SHINYLOADTEST_* env vars", () => {
    process.env["SHINYLOADTEST_USER"] = "alice"
    process.env["SHINYLOADTEST_PASS"] = "secret"
    const creds = getCreds()
    expect(creds).toEqual({
      user: "alice",
      pass: "secret",
      connectApiKey: null,
    })
  })

  it("falls back to legacy SHINYCANNON_* env vars", () => {
    process.env["SHINYCANNON_USER"] = "alice"
    process.env["SHINYCANNON_PASS"] = "secret"
    const creds = getCreds()
    expect(creds).toEqual({
      user: "alice",
      pass: "secret",
      connectApiKey: null,
    })
  })

  it("SHINYLOADTEST_* takes precedence over SHINYCANNON_*", () => {
    process.env["SHINYLOADTEST_USER"] = "new-alice"
    process.env["SHINYCANNON_USER"] = "old-alice"
    process.env["SHINYLOADTEST_PASS"] = "new-secret"
    process.env["SHINYCANNON_PASS"] = "old-secret"
    const creds = getCreds()
    expect(creds).toEqual({
      user: "new-alice",
      pass: "new-secret",
      connectApiKey: null,
    })
  })

  it("API key takes precedence over user/pass", () => {
    process.env["SHINYLOADTEST_USER"] = "alice"
    process.env["SHINYLOADTEST_PASS"] = "secret"
    process.env["SHINYLOADTEST_CONNECT_API_KEY"] = "my-key"
    const creds = getCreds()
    expect(creds).toEqual({ user: null, pass: null, connectApiKey: "my-key" })
  })

  it("falls back to legacy SHINYCANNON_CONNECT_API_KEY", () => {
    process.env["SHINYCANNON_CONNECT_API_KEY"] = "legacy-key"
    const creds = getCreds()
    expect(creds).toEqual({
      user: null,
      pass: null,
      connectApiKey: "legacy-key",
    })
  })

  it("treats empty API key as null", () => {
    process.env["SHINYLOADTEST_CONNECT_API_KEY"] = ""
    process.env["SHINYLOADTEST_USER"] = "bob"
    process.env["SHINYLOADTEST_PASS"] = "pass"
    const creds = getCreds()
    expect(creds).toEqual({ user: "bob", pass: "pass", connectApiKey: null })
  })

  it("treats empty user as null", () => {
    process.env["SHINYLOADTEST_USER"] = ""
    const creds = getCreds()
    expect(creds.user).toBeNull()
  })
})
