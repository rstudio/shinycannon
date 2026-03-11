import { describe, it, expect } from "vitest"

import { Stats } from "../session.js"
import { formatNumber, formatRate } from "../ui.js"

describe("Stats", () => {
  it("tracks event count via recordEvent()", () => {
    const stats = new Stats()
    expect(stats.getCounts().events).toBe(0)

    stats.recordEvent()
    stats.recordEvent()
    stats.recordEvent()
    expect(stats.getCounts().events).toBe(3)
  })

  it("includes events in getCounts()", () => {
    const stats = new Stats()
    stats.transition("running")
    stats.recordEvent()
    stats.recordEvent()
    stats.transition("done")

    const counts = stats.getCounts()
    expect(counts).toEqual({
      running: 0,
      done: 1,
      failed: 0,
      canceled: 0,
      events: 2,
    })
  })

  it("includes events in toString()", () => {
    const stats = new Stats()
    stats.recordEvent()
    expect(stats.toString()).toContain("Events: 1")
  })

  it("accumulates events across multiple sessions", () => {
    const stats = new Stats()

    stats.transition("running")
    stats.recordEvent()
    stats.recordEvent()
    stats.transition("done")

    stats.transition("running")
    stats.recordEvent()
    stats.recordEvent()
    stats.recordEvent()
    stats.transition("done")

    expect(stats.getCounts().events).toBe(5)
    expect(stats.getCounts().done).toBe(2)
  })
})

describe("formatNumber", () => {
  it("formats zero", () => {
    expect(formatNumber(0)).toBe("0")
  })

  it("formats small numbers without commas", () => {
    expect(formatNumber(42)).toBe("42")
  })

  it("formats large numbers with commas", () => {
    expect(formatNumber(1247)).toBe("1,247")
    expect(formatNumber(1000000)).toBe("1,000,000")
  })
})

describe("formatRate", () => {
  it("uses 2 decimal places for rates below 10", () => {
    expect(formatRate(0)).toBe("0.00")
    expect(formatRate(0.5)).toBe("0.50")
    expect(formatRate(9.99)).toBe("9.99")
  })

  it("uses 1 decimal place for rates 10-99", () => {
    expect(formatRate(10)).toBe("10.0")
    expect(formatRate(42.36)).toBe("42.4")
    expect(formatRate(99.9)).toBe("99.9")
  })

  it("uses 0 decimal places for rates >= 100", () => {
    expect(formatRate(100)).toBe("100")
    expect(formatRate(999.7)).toBe("1000")
  })
})
