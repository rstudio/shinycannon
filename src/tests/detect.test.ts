import { describe, it, expect } from "vitest";
import { hasShinyJs } from "../detect.js";

describe("hasShinyJs", () => {
  it("detects shiny.min.js with single quotes", () => {
    expect(hasShinyJs("src = 'shared/shiny.min.js'")).toBe(true);
  });

  it("detects shiny.min.js with double quotes", () => {
    expect(hasShinyJs('src="/shiny.min.js"')).toBe(true);
  });

  it("detects shiny.js", () => {
    expect(hasShinyJs('src="/shiny.js"')).toBe(true);
  });

  it("returns false for non-Shiny HTML", () => {
    expect(hasShinyJs('<div class="header"><div class="wrap">')).toBe(false);
  });

  it("detects in full HTML page", () => {
    const html = `<!DOCTYPE html>
<html><head>
<script src="shared/shiny.min.js"></script>
</head><body></body></html>`;
    expect(hasShinyJs(html)).toBe(true);
  });
});
