/**
 * Terminal UI module. Provides a beautiful interactive display during
 * load tests when stderr is a TTY. Falls back gracefully when not.
 */

import ora, { type Ora } from "ora"
import { bold, cyan, dim, green, red } from "yoctocolors"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UIConfig {
  version: string
  appUrl: string
  workers: number
  loadedDurationMinutes: number
  outputDir: string
}

export interface StatsCounts {
  running: number
  done: number
  failed: number
  canceled: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min > 0) return `${min}m ${String(sec).padStart(2, "0")}s`
  return `${sec}s`
}

function progressBar(fraction: number, width = 30): string {
  const clamped = Math.min(1, Math.max(0, fraction))
  const filled = Math.round(clamped * width)
  const empty = width - filled
  return cyan("\u2588".repeat(filled)) + dim("\u2591".repeat(empty))
}

function statsLine(stats: StatsCounts): string {
  const running = green(`Running: ${stats.running}`)
  const done = cyan(`Done: ${stats.done}`)
  const failed =
    stats.failed > 0
      ? red(`Failed: ${stats.failed}`)
      : dim(`Failed: ${stats.failed}`)
  return `${running}   ${done}   ${failed}`
}

// ---------------------------------------------------------------------------
// TerminalUI
// ---------------------------------------------------------------------------

export class TerminalUI {
  private config: UIConfig
  private spinner: Ora
  private updateTimer: ReturnType<typeof setInterval> | null = null
  private warmupCount = 0
  private loadedStartTime = 0
  private loadedDurationMs = 0
  private getStats: (() => StatsCounts) | null = null
  private testStartTime = 0

  constructor(config: UIConfig) {
    this.config = config
    this.spinner = ora({
      stream: process.stderr,
      color: "cyan",
      discardStdin: false,
    })
    this.testStartTime = Date.now()
  }

  showBanner(): void {
    const { version, appUrl, workers, loadedDurationMinutes, outputDir } =
      this.config
    const w = process.stderr.write.bind(process.stderr)

    w("\n")
    w(`  ${bold(cyan("shinyloadtest"))} ${dim(`v${version}`)}\n`)
    w("\n")
    w(`  ${dim("Target:")}    ${bold(appUrl)}\n`)
    w(`  ${dim("Workers:")}   ${bold(String(workers))}\n`)
    w(`  ${dim("Duration:")}  ${bold(`${loadedDurationMinutes} min`)}\n`)
    w(`  ${dim("Output:")}    ${bold(outputDir)}\n`)
    w("\n")
  }

  startWarmup(): void {
    this.warmupCount = 0
    this.spinner.start(this.warmupText())
  }

  workerReady(): void {
    this.warmupCount++
    this.spinner.text = this.warmupText()
  }

  startLoaded(getStats: () => StatsCounts): void {
    this.getStats = getStats
    this.loadedStartTime = Date.now()
    this.loadedDurationMs = this.config.loadedDurationMinutes * 60_000

    this.spinner.succeed("Warmup complete")
    this.spinner = ora({
      stream: process.stderr,
      color: "cyan",
      discardStdin: false,
    })
    this.spinner.start(this.loadedText())

    this.updateTimer = setInterval(() => {
      this.spinner.text = this.loadedText()
    }, 1000)
  }

  startShutdown(): void {
    this.stopUpdates()
    this.spinner.succeed("Loaded phase complete")
    this.spinner = ora({
      stream: process.stderr,
      color: "cyan",
      discardStdin: false,
    })
    this.spinner.start("Waiting for workers to finish...")
  }

  finish(stats: StatsCounts): void {
    this.stopUpdates()
    this.spinner.succeed("Complete")

    const totalDuration = Date.now() - this.testStartTime
    const w = process.stderr.write.bind(process.stderr)

    w("\n")
    w(`  ${dim("Sessions:")}  ${bold(green(String(stats.done)))} completed`)
    if (stats.failed > 0) {
      w(`, ${bold(red(String(stats.failed)))} failed`)
    }
    if (stats.canceled > 0) {
      w(`, ${dim(String(stats.canceled))} canceled`)
    }
    w("\n")
    w(`  ${dim("Duration:")}  ${bold(formatDuration(totalDuration))}\n`)
    w("\n")
  }

  private warmupText(): string {
    return `Warming up ${dim(`(${this.warmupCount}/${this.config.workers} ready)`)}`
  }

  private loadedText(): string {
    const stats = this.getStats?.() ?? {
      running: 0,
      done: 0,
      failed: 0,
      canceled: 0,
    }
    const elapsed = Date.now() - this.loadedStartTime
    const remaining = Math.max(0, this.loadedDurationMs - elapsed)
    const fraction = Math.min(1, elapsed / this.loadedDurationMs)
    const pct = Math.round(fraction * 100)

    return [
      `${bold("Loaded")}  ${bold(formatDuration(remaining))} ${dim("remaining")}`,
      `  ${progressBar(fraction)}  ${bold(String(pct))}${dim("%")}`,
      `  ${statsLine(stats)}`,
    ].join("\n")
  }

  cleanup(): void {
    this.stopUpdates()
    this.spinner.stop()
  }

  private stopUpdates(): void {
    if (this.updateTimer !== null) {
      clearInterval(this.updateTimer)
      this.updateTimer = null
    }
  }
}
