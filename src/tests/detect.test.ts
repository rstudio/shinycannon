import { describe, it, expect } from "vitest"
import { hasShinyJs, detectServerType } from "../detect.js"
import type { HttpClient } from "../http.js"
import { ServerType } from "../types.js"

describe("hasShinyJs", () => {
  it("detects shiny.min.js with single quotes", () => {
    expect(hasShinyJs("src = 'shared/shiny.min.js'")).toBe(true)
  })

  it("detects shiny.min.js with double quotes", () => {
    expect(hasShinyJs('src="/shiny.min.js"')).toBe(true)
  })

  it("detects shiny.js", () => {
    expect(hasShinyJs('src="/shiny.js"')).toBe(true)
  })

  it("returns false for non-Shiny HTML", () => {
    expect(hasShinyJs('<div class="header"><div class="wrap">')).toBe(false)
  })

  it("detects in full HTML page", () => {
    const html = `<!DOCTYPE html>
<html><head>
<script src="shared/shiny.min.js"></script>
</head><body></body></html>`
    expect(hasShinyJs(html)).toBe(true)
  })
})

describe("detectServerType", () => {
  it("detects x-powered-by: Express as SSP (DET-06)", async () => {
    const httpClient: Pick<HttpClient, "get"> = {
      get: async () => ({
        statusCode: 200,
        headers: { "x-powered-by": "Express" },
        body: "<html></html>",
      }),
    }
    const result = await detectServerType(
      "https://example.com/app",
      httpClient as HttpClient,
    )
    expect(result).toBe(ServerType.SSP)
  })
})
