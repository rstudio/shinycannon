import { describe, it, expect, afterEach } from "vitest"
import * as fs from "node:fs"
import * as net from "node:net"
import * as path from "node:path"
import * as os from "node:os"

import { runSession, Stats } from "../session.js"
import { readRecordingFromString } from "../recording.js"
import { MockShinyServer } from "./helpers/mock-shiny-server.js"
import { createLogger, LogLevel } from "../logger.js"
import type { Logger } from "../logger.js"
import { createOutputDir } from "../output.js"

/** Get an unused local port by briefly binding and releasing. */
function getUnusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
    srv.on("error", reject)
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runSessionAndReadCsv(
  mock: MockShinyServer,
  sessionId: number,
): Promise<{ lines: string[]; stats: Stats; events: string[] }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shinycannon-err-"))
  try {
    const recordingPath = path.join(tmpDir, "recording.log")
    fs.writeFileSync(recordingPath, mock.makeRecording())
    const outputDir = path.join(tmpDir, "output")
    createOutputDir({
      outputDir,
      overwrite: false,
      version: "test",
      recordingPath,
    })

    const recording = readRecordingFromString(
      fs.readFileSync(recordingPath, "utf-8"),
    )
    const stats = new Stats()
    const logger = createLogger({ name: "test", consoleLevel: LogLevel.SILENT })

    await runSession(
      {
        sessionId,
        workerId: 0,
        iterationId: 0,
        httpUrl: mock.url,
        recording,
        recordingPath,
        headers: {},
        creds: { user: null, pass: null, connectApiKey: null },
        logger,
        outputDir,
        argsString: "test",
        argsJson: "{}",
      },
      stats,
    )

    const csvPath = path.join(outputDir, "sessions", `${sessionId}_0_0.csv`)
    const lines = fs
      .readFileSync(csvPath, "utf-8")
      .split("\n")
      .filter((l) => l.length > 0)
    const dataLines = lines.filter(
      (l) => !l.startsWith("#") && !l.startsWith("session_id"),
    )
    const events = dataLines.map((l) => l.split(",")[3]!).filter(Boolean)

    return { lines, stats, events }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("error handling", { timeout: 30_000 }, () => {
  const tmpDirs: string[] = []

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    tmpDirs.length = 0
  })

  it("handles connection refused (ERR-01)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shinycannon-err-"))
    tmpDirs.push(tmpDir)

    const unusedPort = await getUnusedPort()
    const badUrl = `http://127.0.0.1:${unusedPort}`
    const recordingContent = [
      "# version: 1",
      `# target_url: ${badUrl}`,
      "# target_type: R/Shiny",
      JSON.stringify({
        type: "REQ_HOME",
        begin: "2020-01-01T00:00:00.000Z",
        url: "/",
        status: 200,
      }),
      JSON.stringify({ type: "WS_CLOSE", begin: "2020-01-01T00:00:01.000Z" }),
    ].join("\n")

    const recordingPath = path.join(tmpDir, "recording.log")
    fs.writeFileSync(recordingPath, recordingContent)
    const outputDir = path.join(tmpDir, "output")
    createOutputDir({
      outputDir,
      overwrite: false,
      version: "test",
      recordingPath,
    })

    const recording = readRecordingFromString(recordingContent)
    const stats = new Stats()
    const logger = createLogger({ name: "test", consoleLevel: LogLevel.SILENT })

    await runSession(
      {
        sessionId: 100,
        workerId: 0,
        iterationId: 0,
        httpUrl: badUrl,
        recording,
        recordingPath,
        headers: {},
        creds: { user: null, pass: null, connectApiKey: null },
        logger,
        outputDir,
        argsString: "test",
        argsJson: "{}",
      },
      stats,
    )

    const csvPath = path.join(outputDir, "sessions", "100_0_0.csv")
    const lines = fs
      .readFileSync(csvPath, "utf-8")
      .split("\n")
      .filter((l) => l.length > 0)
    const events = lines
      .filter((l) => !l.startsWith("#") && !l.startsWith("session_id"))
      .map((l) => l.split(",")[3])

    expect(events).toContain("PLAYBACK_FAIL")
    expect(stats.getCounts().failed).toBe(1)
  })

  it("records failure on HTTP status mismatch (ERR-02)", async () => {
    const mock = new MockShinyServer({ homeStatus: 500 })
    await mock.start()
    try {
      const result = await runSessionAndReadCsv(mock, 101)
      expect(result.events).toContain("PLAYBACK_FAIL")
      expect(result.stats.getCounts().failed).toBe(1)
    } finally {
      await mock.stop()
    }
  })

  it("treats 200 response as success (ERR-03, 200/304 equivalence unit-tested in http.test.ts)", async () => {
    const mock = new MockShinyServer()
    await mock.start()
    try {
      const result = await runSessionAndReadCsv(mock, 102)
      expect(result.events).toContain("PLAYBACK_DONE")
      expect(result.stats.getCounts().done).toBe(1)
    } finally {
      await mock.stop()
    }
  })

  it("records failure on WebSocket disconnect (ERR-04)", async () => {
    const mock = new MockShinyServer({ wsDropAfterInit: true })
    await mock.start()
    try {
      const result = await runSessionAndReadCsv(mock, 103)
      expect(result.events).toContain("PLAYBACK_FAIL")
      expect(result.stats.getCounts().failed).toBe(1)
    } finally {
      await mock.stop()
    }
  })

  it("reports 'Datafile not found' for missing REQ_POST datafile (ENOENT)", async () => {
    const mock = new MockShinyServer()
    await mock.start()
    try {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shinycannon-err-"))
      tmpDirs.push(tmpDir)

      // Recording with a REQ_POST that references a non-existent datafile
      const recordingContent = [
        "# version: 1",
        `# target_url: ${mock.url}`,
        "# target_type: R/Shiny",
        JSON.stringify({
          type: "REQ_HOME",
          begin: "2020-01-01T00:00:00.000Z",
          url: "/",
          status: 200,
        }),
        JSON.stringify({
          type: "REQ_POST",
          begin: "2020-01-01T00:00:00.100Z",
          url: "/upload",
          status: 200,
          datafile: "nonexistent.csv",
        }),
        JSON.stringify({ type: "WS_CLOSE", begin: "2020-01-01T00:00:01.000Z" }),
      ].join("\n")

      const recordingPath = path.join(tmpDir, "recording.log")
      fs.writeFileSync(recordingPath, recordingContent)
      const outputDir = path.join(tmpDir, "output")
      createOutputDir({
        outputDir,
        overwrite: false,
        version: "test",
        recordingPath,
      })

      const recording = readRecordingFromString(recordingContent)
      const stats = new Stats()
      const errorMessages: string[] = []
      const logger: Logger = {
        debug() {},
        info() {},
        warn() {},
        error(msg: string) {
          errorMessages.push(msg)
        },
        child() {
          return this
        },
      }

      await runSession(
        {
          sessionId: 105,
          workerId: 0,
          iterationId: 0,
          httpUrl: mock.url,
          recording,
          recordingPath,
          headers: {},
          creds: { user: null, pass: null, connectApiKey: null },
          logger,
          outputDir,
          argsString: "test",
          argsJson: "{}",
        },
        stats,
      )

      const csvPath = path.join(outputDir, "sessions", "105_0_0.csv")
      const lines = fs
        .readFileSync(csvPath, "utf-8")
        .split("\n")
        .filter((l) => l.length > 0)
      const events = lines
        .filter((l) => !l.startsWith("#") && !l.startsWith("session_id"))
        .map((l) => l.split(",")[3]!)
        .filter(Boolean)

      expect(events).toContain("PLAYBACK_FAIL")
      expect(stats.getCounts().failed).toBe(1)
      // Verify the error message specifically mentions "Datafile not found"
      const datafileError = errorMessages.find((m) =>
        m.includes("Datafile not found"),
      )
      expect(datafileError).toBeDefined()
    } finally {
      await mock.stop()
    }
  })

  it("records failure on WebSocket queue overflow (BC-03)", async () => {
    // Send 60 messages (> RECEIVE_QUEUE_SIZE of 50) before session can consume them
    const mock = new MockShinyServer({ wsFloodCount: 60 })
    await mock.start()
    try {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shinycannon-bc03-"))
      tmpDirs.push(tmpDir)

      const recordingPath = path.join(tmpDir, "recording.log")
      fs.writeFileSync(recordingPath, mock.makeRecording())
      const outputDir = path.join(tmpDir, "output")
      createOutputDir({
        outputDir,
        overwrite: false,
        version: "test",
        recordingPath,
      })

      const recording = readRecordingFromString(
        fs.readFileSync(recordingPath, "utf-8"),
      )
      const stats = new Stats()
      const errorMessages: string[] = []
      const logger: Logger = {
        debug() {},
        info() {},
        warn() {},
        error(msg: string) {
          errorMessages.push(msg)
        },
        child() {
          return this
        },
      }

      await runSession(
        {
          sessionId: 106,
          workerId: 0,
          iterationId: 0,
          httpUrl: mock.url,
          recording,
          recordingPath,
          headers: {},
          creds: { user: null, pass: null, connectApiKey: null },
          logger,
          outputDir,
          argsString: "test",
          argsJson: "{}",
        },
        stats,
      )

      const csvPath = path.join(outputDir, "sessions", "106_0_0.csv")
      const lines = fs
        .readFileSync(csvPath, "utf-8")
        .split("\n")
        .filter((l) => l.length > 0)
      const events = lines
        .filter((l) => !l.startsWith("#") && !l.startsWith("session_id"))
        .map((l) => l.split(",")[3]!)
        .filter(Boolean)

      expect(events).toContain("PLAYBACK_FAIL")
      expect(stats.getCounts().failed).toBe(1)
      // Verify the error is specifically about queue overflow
      const overflowError = errorMessages.find((m) =>
        m.includes("Message queue is full"),
      )
      expect(overflowError).toBeDefined()
    } finally {
      await mock.stop()
    }
  })

  it("always writes PLAYER_SESSION_CREATE even on failure", async () => {
    const mock = new MockShinyServer({ homeStatus: 500 })
    await mock.start()
    try {
      const result = await runSessionAndReadCsv(mock, 104)
      expect(result.events[0]).toBe("PLAYER_SESSION_CREATE")
      expect(result.events).toContain("PLAYBACK_FAIL")
    } finally {
      await mock.stop()
    }
  })

  it("abort signal cancels session without incrementing failed count", async () => {
    const mock = new MockShinyServer()
    await mock.start()
    try {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "shinycannon-abort-"),
      )
      tmpDirs.push(tmpDir)

      // Recording with a long sleep between events so abort fires mid-session
      const recordingContent = [
        "# version: 1",
        `# target_url: ${mock.url}`,
        "# target_type: R/Shiny",
        JSON.stringify({
          type: "REQ_HOME",
          begin: "2020-01-01T00:00:00.000Z",
          url: "/",
          status: 200,
        }),
        JSON.stringify({
          type: "WS_OPEN",
          begin: "2020-01-01T00:00:00.100Z",
          url: "sockjs/123/abc/websocket",
        }),
        JSON.stringify({
          type: "WS_RECV_INIT",
          begin: "2020-01-01T00:00:00.200Z",
          message: "o",
        }),
        JSON.stringify({
          type: "WS_SEND",
          begin: "2020-01-01T00:00:00.300Z",
          message: "test",
        }),
        // 60s gap — abort will fire before this event
        JSON.stringify({ type: "WS_CLOSE", begin: "2020-01-01T00:01:00.300Z" }),
      ].join("\n")

      const recordingPath = path.join(tmpDir, "recording.log")
      fs.writeFileSync(recordingPath, recordingContent)
      const outputDir = path.join(tmpDir, "output")
      createOutputDir({
        outputDir,
        overwrite: false,
        version: "test",
        recordingPath,
      })

      const recording = readRecordingFromString(recordingContent)
      const stats = new Stats()
      const logger = createLogger({
        name: "test",
        consoleLevel: LogLevel.SILENT,
      })

      const abortController = new AbortController()
      // Abort after 500ms — session will be mid-sleep
      setTimeout(() => abortController.abort(), 500)

      await runSession(
        {
          sessionId: 200,
          workerId: 0,
          iterationId: 0,
          httpUrl: mock.url,
          recording,
          recordingPath,
          headers: {},
          creds: { user: null, pass: null, connectApiKey: null },
          logger,
          outputDir,
          argsString: "test",
          argsJson: "{}",
          signal: abortController.signal,
        },
        stats,
      )

      const csvPath = path.join(outputDir, "sessions", "200_0_0.csv")
      const lines = fs
        .readFileSync(csvPath, "utf-8")
        .split("\n")
        .filter((l) => l.length > 0)
      const events = lines
        .filter((l) => !l.startsWith("#") && !l.startsWith("session_id"))
        .map((l) => l.split(",")[3]!)
        .filter(Boolean)

      expect(events).toContain("PLAYBACK_CANCEL")
      expect(events).not.toContain("PLAYBACK_FAIL")
      expect(stats.getCounts().failed).toBe(0)
      expect(stats.getCounts().done).toBe(0)
      expect(stats.getCounts().canceled).toBe(1)
    } finally {
      await mock.stop()
    }
  })
})
