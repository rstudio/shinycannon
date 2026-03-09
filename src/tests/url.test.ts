import { describe, it, expect } from "vitest";
import { joinPaths, httpToWs, clearQueryParams, appendPath } from "../url.js";

describe("joinPaths", () => {
  it("handles no trailing/leading slashes", () => {
    expect(joinPaths("http://example.com/app", "path")).toBe("http://example.com/app/path");
  });
  it("handles trailing slash on base", () => {
    expect(joinPaths("http://example.com/app/", "path")).toBe("http://example.com/app/path");
  });
  it("handles leading slash on path", () => {
    expect(joinPaths("http://example.com/app", "/path")).toBe("http://example.com/app/path");
  });
  it("handles both slashes", () => {
    expect(joinPaths("http://example.com/app/", "/path")).toBe("http://example.com/app/path");
  });
});

describe("httpToWs", () => {
  it("converts http to ws", () => {
    expect(httpToWs("http://example.com/app")).toBe("ws://example.com/app");
  });
  it("converts https to wss", () => {
    expect(httpToWs("https://example.com/app")).toBe("wss://example.com/app");
  });
  it("clears query parameters", () => {
    expect(httpToWs("http://example.com/app?foo=bar&baz=qux")).toBe("ws://example.com/app");
  });
  it("throws on unknown scheme", () => {
    expect(() => httpToWs("ftp://example.com")).toThrow();
  });
});

describe("clearQueryParams", () => {
  it("removes query string", () => {
    expect(clearQueryParams("http://example.com/app?foo=bar")).toBe("http://example.com/app");
  });
  it("preserves URL without query string", () => {
    expect(clearQueryParams("http://example.com/app")).toBe("http://example.com/app");
  });
  it("preserves hash", () => {
    expect(clearQueryParams("http://example.com/app?foo=bar#section")).toBe("http://example.com/app#section");
  });
});

describe("appendPath", () => {
  it("appends a relative path to a base URL", () => {
    expect(appendPath("http://example.com/app", "api/data")).toBe("http://example.com/app/api/data");
  });
  it("handles trailing slash on base URL", () => {
    expect(appendPath("http://example.com/app/", "api/data")).toBe("http://example.com/app/api/data");
  });
  it("handles leading slash on path", () => {
    expect(appendPath("http://example.com/app", "/api/data")).toBe("http://example.com/app/api/data");
  });
});
