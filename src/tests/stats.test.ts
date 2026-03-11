import { describe, it, expect } from "vitest"

import { Stats } from "../session.js"

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
